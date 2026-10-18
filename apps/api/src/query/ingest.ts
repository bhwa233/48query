import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import {
  ErrorSchema,
  QueryIngestResponseSchema,
  QueryIngestUnitSchema,
  QuerySyncStateSchema,
} from "@starter/shared/schemas";

const BatchCompleteSchema = z.object({
  completedAt: z.string().max(80),
  membersCovered: z.number().int().nonnegative(),
  totalMembers: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  errorMessage: z.string().max(2000).nullable().optional(),
});
const unavailable = { description: "Collector ingestion is not configured.", content: { "application/json": { schema: ErrorSchema } } };

const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (!result.success) return c.json({ ok: false as const, error: { code: "invalid_request", message: "Request validation failed." } }, 400);
  },
});

app.use("*", async (c, next) => {
  if (!c.env.APP_DB) return c.json({ ok: false, error: { code: "database_not_configured", message: "Enable the D1 profile to use collector ingestion." } }, 503);
  if (!c.env.INGEST_KEY) return c.json({ ok: false, error: { code: "ingestion_not_configured", message: "Set INGEST_KEY before enabling collector writes." } }, 503);
  if (c.req.header("X-Ingest-Key") !== c.env.INGEST_KEY) return c.json({ ok: false, error: { code: "unauthorized", message: "Invalid ingestion key." } }, 401);
  await next();
});

app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ ok: false, error: { code: "http_error", message: error.message } }, error.status);
  console.error(error);
  return c.json({ ok: false, error: { code: "internal_error", message: "Unexpected ingestion error." } }, 500);
});

function database(c: { env: AppEnv["Bindings"] }) {
  if (!c.env.APP_DB) throw new Error("APP_DB binding is missing");
  return c.env.APP_DB;
}

app.openapi(createRoute({
  method: "post", path: "/unit",
  request: { body: { required: true, content: { "application/json": { schema: QueryIngestUnitSchema } } } },
  responses: { 200: { description: "Ingested one member page.", content: { "application/json": { schema: QueryIngestResponseSchema } } }, 400: { description: "Invalid ingest unit.", content: { "application/json": { schema: ErrorSchema } } }, 401: unavailable, 503: unavailable },
}), async (c) => {
  const db = database(c);
  const input = c.req.valid("json");
  const now = new Date().toISOString();
  const statements = [
    db.prepare("INSERT INTO query_batches (id, stat_date, status, started_at, members_covered, total_members, error_count) VALUES (?, ?, 'running', ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET members_covered = excluded.members_covered, total_members = excluded.total_members, error_count = excluded.error_count, error_message = NULL").bind(input.batchId, input.statDate, input.startedAt, input.membersCovered, input.totalMembers, input.errorCount),
    db.prepare("INSERT INTO query_members (id, name, pinyin, group_name, team, room_id, channel_id, server_id, live_room_id, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, pinyin = excluded.pinyin, group_name = excluded.group_name, team = excluded.team, room_id = excluded.room_id, channel_id = excluded.channel_id, server_id = excluded.server_id, live_room_id = excluded.live_room_id, status = excluded.status, updated_at = excluded.updated_at").bind(input.member.id, input.member.name, input.member.pinyin ?? null, input.member.groupName, input.member.team ?? null, input.member.roomId ?? null, input.member.channelId ?? null, input.member.serverId ?? null, input.member.liveRoomId ?? null, input.member.status, now),
    db.prepare("INSERT INTO query_sync_state (member_id, message_cursor, recording_cursor, updated_at, last_error) VALUES (?, ?, ?, ?, NULL) ON CONFLICT(member_id) DO UPDATE SET message_cursor = excluded.message_cursor, recording_cursor = excluded.recording_cursor, updated_at = excluded.updated_at, last_error = NULL").bind(input.member.id, input.messageCursor ?? null, input.recordingCursor ?? null, now),
    ...input.messages.map((message) => db.prepare("INSERT INTO query_messages (id, member_id, occurred_at, type, text, sender_id, sender_name, sender_type, source_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET member_id = excluded.member_id, occurred_at = excluded.occurred_at, type = excluded.type, text = excluded.text, sender_id = excluded.sender_id, sender_name = excluded.sender_name, sender_type = excluded.sender_type, source_json = excluded.source_json").bind(message.id, message.memberId, message.occurredAt, message.type, message.text ?? null, message.senderId ?? null, message.senderName ?? null, message.senderType ?? null, message.sourceJson ?? null)),
    ...input.recordings.map((recording) => db.prepare("INSERT INTO query_recordings (id, member_id, title, occurred_at, duration_seconds, danmaku_count, danmaku_status, source_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET member_id = excluded.member_id, title = excluded.title, occurred_at = excluded.occurred_at, duration_seconds = excluded.duration_seconds, danmaku_count = excluded.danmaku_count, danmaku_status = excluded.danmaku_status, source_json = excluded.source_json").bind(recording.id, recording.memberId, recording.title ?? null, recording.occurredAt, recording.durationSeconds ?? null, recording.danmakuCount, recording.danmakuStatus, recording.sourceJson ?? null)),
  ];
  await db.batch(statements);
  return c.json({ ok: true as const, data: { batchId: input.batchId, memberId: input.member.id, messagesWritten: input.messages.length, recordingsWritten: input.recordings.length } }, 200);
});

app.openapi(createRoute({
  method: "get", path: "/state/{memberId}", request: { params: z.object({ memberId: z.string().min(1).max(100) }) },
  responses: { 200: { description: "Member sync cursor.", content: { "application/json": { schema: QuerySyncStateSchema } } }, 401: unavailable, 503: unavailable },
}), async (c) => {
  const db = database(c);
  const memberId = c.req.valid("param").memberId;
  const result = await db.prepare("SELECT member_id, message_cursor, recording_cursor, updated_at, last_error FROM query_sync_state WHERE member_id = ?").bind(memberId).all<{ member_id: string; message_cursor: string | null; recording_cursor: string | null; updated_at: string; last_error: string | null }>();
  const row = result.results[0];
  return c.json({ ok: true as const, data: { memberId, messageCursor: row?.message_cursor ?? null, recordingCursor: row?.recording_cursor ?? null, updatedAt: row?.updated_at ?? "", lastError: row?.last_error ?? null } }, 200);
});

app.openapi(createRoute({
  method: "post", path: "/batches/{batchId}/complete", request: { params: z.object({ batchId: z.string().min(1).max(100) }), body: { required: true, content: { "application/json": { schema: BatchCompleteSchema } } } },
  responses: { 200: { description: "Completed collector batch.", content: { "application/json": { schema: QueryIngestResponseSchema } } }, 400: { description: "Invalid batch completion.", content: { "application/json": { schema: ErrorSchema } } }, 401: unavailable, 404: { description: "Batch not found.", content: { "application/json": { schema: ErrorSchema } } }, 503: unavailable },
}), async (c) => {
  const db = database(c);
  const batchId = c.req.valid("param").batchId;
  const input = c.req.valid("json");
  const status = input.errorCount > 0 ? "failed" : "completed";
  const result = await db.prepare("UPDATE query_batches SET status = ?, completed_at = ?, members_covered = ?, total_members = ?, error_count = ?, error_message = ? WHERE id = ?").bind(status, input.completedAt, input.membersCovered, input.totalMembers, input.errorCount, input.errorMessage ?? null, batchId).run();
  if (!result.meta.changes) return c.json({ ok: false as const, error: { code: "not_found", message: "Batch not found." } }, 404);
  return c.json({ ok: true as const, data: { batchId, memberId: "", messagesWritten: 0, recordingsWritten: 0 } }, 200);
});

export default app;
