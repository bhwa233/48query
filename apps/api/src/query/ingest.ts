import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { timingSafeEqual } from "node:crypto";
import { drizzle } from "drizzle-orm/d1";
import type { AppEnv } from "../env";
import { ErrorSchema, ImageAttachmentSchema, VideoAttachmentSchema, QueryMessageSchema, QueryIngestResponseSchema, QueryIngestUnitSchema, QuerySyncStateSchema, SourceSyncSchema, CatalogEntrySchema, CollectorSinceSchema, CollectorProgressSchema } from "@starter/shared/schemas";
import { imageProjection, imageStatement, readImage } from "./images";
import { videoProjection, videoStatement, readVideo } from "./videos";
import { readMessages } from "./messages";
import { registerMeleeIngest } from "./melee";

const BatchCompleteSchema = z.object({ completedAt: z.string().max(80), membersCovered: z.number().int().nonnegative(), totalMembers: z.number().int().nonnegative(), errorCount: z.number().int().nonnegative(), errorMessage: z.string().max(2000).nullable().optional() });
const unavailable = { description: "Collector ingestion is not configured or authorized.", content: { "application/json": { schema: ErrorSchema } } };
const app = new OpenAPIHono<AppEnv>({ defaultHook: (result, c) => { if (!result.success) return c.json({ ok: false as const, error: { code: "invalid_request", message: "Request validation failed." } }, 400); } });
app.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (!c.env.APP_DB) return c.json({ ok: false, error: { code: "database_not_configured", message: "Enable the D1 profile to use collector ingestion." } }, 503);
  if (!c.env.INGEST_KEY) return c.json({ ok: false, error: { code: "ingestion_not_configured", message: "Set INGEST_KEY before enabling collector writes." } }, 503);
  const actual = new TextEncoder().encode(c.req.header("X-Ingest-Key") ?? "");
  const expected = new TextEncoder().encode(c.env.INGEST_KEY);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return c.json({ ok: false, error: { code: "unauthorized", message: "Invalid ingestion key." } }, 401);
  await next();
});
app.onError((error, c) => {
  if (/no such table:.*query_(?:melee_|follower_snapshots)/.test(`${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`)) return c.json({ ok: false as const, error: { code: "ranking_storage_not_configured", message: "Apply the ranking migrations before collecting fans or weekly rankings." } }, 503);
  if (/no such table:.*query_collector_progress/.test(`${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`)) return c.json({ ok: false as const, error: { code: "collector_progress_not_configured", message: "Apply the collector progress migration before enabling scheduled collection." } }, 503);
  if (error instanceof HTTPException) return c.json({ ok: false, error: { code: "http_error", message: error.message } }, error.status);
  console.error(JSON.stringify({ event: "ingest_failed", name: error.name }));
  return c.json({ ok: false, error: { code: "internal_error", message: "Unexpected ingestion error." } }, 500);
});
function database(c: { env: AppEnv["Bindings"] }) { if (!c.env.APP_DB) throw new Error("APP_DB binding is missing"); return c.env.APP_DB; }
registerMeleeIngest(app);

app.openapi(createRoute({ method: "get", path: "/progress", request: { query: z.object({ since: CollectorSinceSchema, after: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(100) }) }, responses: { 200: { description: "Private, date-scoped resumable collector progress.", content: { "application/json": { schema: z.object({ ok: z.literal(true), data: z.array(CollectorProgressSchema), nextCursor: z.string().nullable() }) } } }, 400: unavailable, 401: unavailable, 503: unavailable } }), async c => {
  const { since: rawSince, after, limit } = c.req.valid("query");
  const since = new Date(rawSince).toISOString();
  const rows = await database(c).prepare("SELECT member_id, revision, state_json FROM query_collector_progress WHERE since = ? AND member_id > ? ORDER BY member_id LIMIT ?").bind(since, after ?? "", limit + 1).all<{ member_id: string; revision: number; state_json: string }>();
  const data = rows.results.slice(0, limit).map(row => CollectorProgressSchema.parse({ ...JSON.parse(row.state_json), revision: row.revision }));
  return c.json({ ok: true as const, data, nextCursor: rows.results.length > limit ? data.at(-1)!.memberId : null }, 200);
});
app.openapi(createRoute({ method: "post", path: "/progress", request: { body: { required: true, content: { "application/json": { schema: CollectorProgressSchema } } } }, responses: { 200: { description: "Saved only after content ingestion; revision prevents stale collectors overwriting newer cursors.", content: { "application/json": { schema: z.object({ ok: z.literal(true), data: z.object({ revision: z.number().int() }) }) } } }, 400: unavailable, 401: unavailable, 409: unavailable, 503: unavailable } }), async c => {
  const submitted = c.req.valid("json");
  const input = { ...submitted, since: new Date(submitted.since).toISOString() };
  const row = await database(c).prepare(`INSERT INTO query_collector_progress (since, member_id, revision, state_json, updated_at)
    SELECT ?, ?, 1, ?, ? WHERE ? = 0 OR EXISTS (SELECT 1 FROM query_collector_progress WHERE since = ? AND member_id = ?)
    ON CONFLICT(since, member_id) DO UPDATE SET revision = query_collector_progress.revision + 1, state_json = excluded.state_json, updated_at = excluded.updated_at
    WHERE query_collector_progress.revision = ? RETURNING revision`)
    .bind(input.since, input.memberId, JSON.stringify(input), new Date().toISOString(), input.revision, input.since, input.memberId, input.revision).first<{ revision: number }>();
  if (!row) return c.json({ ok: false as const, error: { code: "progress_conflict", message: "Collector progress changed; reload before resuming." } }, 409);
  return c.json({ ok: true as const, data: row }, 200);
});

type Member = z.infer<typeof QueryIngestUnitSchema>["member"];
function memberStatement(db: D1Database, member: Member, now: string) {
  return db.prepare(`INSERT INTO query_members (id, name, pinyin, group_name, team, room_id, channel_id, server_id, live_room_id, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, pinyin = COALESCE(excluded.pinyin, query_members.pinyin), group_name = excluded.group_name, team = COALESCE(excluded.team, query_members.team),
    room_id = COALESCE(excluded.room_id, query_members.room_id), channel_id = COALESCE(excluded.channel_id, query_members.channel_id), server_id = COALESCE(excluded.server_id, query_members.server_id), status = excluded.status, updated_at = excluded.updated_at`)
    .bind(member.id, member.name, member.pinyin ?? null, member.groupName, member.team ?? null, member.roomId ?? null, member.channelId ?? null, member.serverId ?? null, member.liveRoomId ?? null, member.status, now);
}

app.openapi(createRoute({ method: "post", path: "/unit", request: { body: { required: true, content: { "application/json": { schema: QueryIngestUnitSchema } } } }, responses: { 200: { description: "Ingested a text/image page and its source checkpoint atomically.", content: { "application/json": { schema: QueryIngestResponseSchema } } }, 400: unavailable, 401: unavailable, 503: unavailable } }), async c => {
  const db = database(c);
  const input = c.req.valid("json");
  const now = new Date().toISOString();
  if (input.messages.some(message => (message.author && message.author.id !== message.memberId) || (message.senderId && message.senderId !== message.memberId))) return c.json({ ok: false as const, error: { code: "invalid_author", message: "Message author and sender must match." } }, 400);
  if (input.followerSnapshot && Date.parse(input.followerSnapshot.observedAt) > Date.now() + 300_000) return c.json({ ok: false as const, error: { code: "invalid_snapshot", message: "Follower observation cannot be in the future." } }, 400);
  const statements = [
    db.prepare("INSERT INTO query_batches (id, stat_date, status, started_at, members_covered, total_members, error_count, counts_tracked) VALUES (?, ?, 'running', ?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET members_covered = excluded.members_covered, total_members = excluded.total_members, error_count = excluded.error_count, error_message = NULL").bind(input.batchId, input.statDate, input.startedAt, input.membersCovered, input.totalMembers, input.errorCount),
    memberStatement(db, input.member, now),
    db.prepare("INSERT INTO query_sync_state (member_id, message_cursor, recording_cursor, updated_at, last_error) VALUES (?, ?, ?, ?, NULL) ON CONFLICT(member_id) DO UPDATE SET message_cursor = excluded.message_cursor, updated_at = excluded.updated_at").bind(input.member.id, input.messageCursor ?? null, input.recordingCursor ?? null, now),
  ];
  if (input.followerSnapshot) statements.push(db.prepare("INSERT INTO query_follower_snapshots (member_id, observed_at, followers) VALUES (?, ?, ?) ON CONFLICT(member_id, observed_at) DO NOTHING")
    .bind(input.member.id, new Date(input.followerSnapshot.observedAt).toISOString(), input.followerSnapshot.count));
  for (const message of input.messages) {
    if (message.author && message.author.id !== input.member.id) statements.push(memberStatement(db, message.author, now));
    statements.push(db.prepare(`INSERT INTO query_messages (id, member_id, occurred_at, type, text, sender_id, sender_name, sender_type, source_json, room_owner_id, room_id, kind, question, answer, source, source_flags, parse_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET text = CASE WHEN (query_messages.source_flags & 8) != 0 AND (excluded.source_flags & 8) = 0 THEN query_messages.text ELSE COALESCE(excluded.text, query_messages.text) END, question = COALESCE(excluded.question, query_messages.question), answer = COALESCE(excluded.answer, query_messages.answer),
      source_flags = query_messages.source_flags | excluded.source_flags,
      kind = CASE WHEN excluded.parse_status = 'parsed' THEN excluded.kind ELSE query_messages.kind END,
      parse_status = CASE WHEN query_messages.parse_status = 'parsed' THEN 'parsed' ELSE excluded.parse_status END`)
      .bind(message.id, message.memberId, message.occurredAt, message.type, message.text ?? null, message.senderId ?? null, message.senderName ?? null, message.senderType ?? null, message.sourceJson ?? null, message.roomOwnerId ?? input.member.id, message.roomId ?? null, message.kind, message.question ?? null, message.answer ?? null, message.source, message.sourceFlags, message.parseStatus));
    for (const [position, image] of message.images.entries()) {
      statements.push(imageStatement(db, image, now));
      statements.push(db.prepare("INSERT INTO query_message_images (message_id, image_id, position) VALUES (?, ?, ?) ON CONFLICT(message_id, image_id) DO NOTHING").bind(message.id, image.id, position));
    }
    for (const [position, video] of message.videos.entries()) {
      statements.push(videoStatement(db, video, now));
      statements.push(db.prepare("INSERT INTO query_message_videos (message_id, video_id, position) VALUES (?, ?, ?) ON CONFLICT(message_id, video_id) DO NOTHING").bind(message.id, video.id, position));
    }
  }
  for (const entry of input.catalog) statements.push(db.prepare(`INSERT INTO query_catalog (member_id, id, source, raw_json, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(member_id, id) DO UPDATE SET status = CASE WHEN query_catalog.status = 'resolved' THEN 'resolved' ELSE excluded.status END,
    raw_json = CASE WHEN query_catalog.status = 'resolved' THEN query_catalog.raw_json
      WHEN excluded.status = 'resolved' THEN excluded.raw_json
      WHEN json_extract(CASE WHEN json_valid(query_catalog.raw_json) THEN query_catalog.raw_json ELSE '{}' END, '$.format') = 'pocket48-album-lookup-v1'
        AND json_extract(CASE WHEN json_valid(excluded.raw_json) THEN excluded.raw_json ELSE '{}' END, '$.format') IS NOT 'pocket48-album-lookup-v1' THEN query_catalog.raw_json
      ELSE excluded.raw_json END, updated_at = excluded.updated_at`)
    .bind(input.member.id, entry.id, entry.source, entry.rawJson, entry.status, now));
  if (input.sync) statements.push(db.prepare("INSERT INTO query_source_sync (member_id, source, state_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(member_id, source) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at").bind(input.member.id, input.sync.source, JSON.stringify(input.sync), now));
  // Uploads and transport retries can ingest the same page repeatedly. Keep
  // unique batch contents in the same transaction as the content/checkpoint.
  const items = input.messages.filter(message => message.parseStatus === "parsed" && ["text", "image", "video", "reply", "post"].includes(message.kind))
    .flatMap(message => [
      { kind: "message", id: message.id },
      ...message.images.map(image => ({ kind: "image", id: image.id })),
      ...message.videos.map(video => ({ kind: "video", id: video.id })),
    ]);
  if (items.length) statements.push(db.prepare(`INSERT INTO query_batch_items (batch_id, kind, item_id)
    SELECT ?, json_extract(value, '$.kind'), json_extract(value, '$.id') FROM json_each(?) WHERE true
    ON CONFLICT(batch_id, kind, item_id) DO NOTHING`).bind(input.batchId, JSON.stringify(items)));
  await db.batch(statements);
  return c.json({ ok: true as const, data: { batchId: input.batchId, memberId: input.member.id, messagesWritten: input.messages.length, recordingsWritten: 0 } }, 200);
});

app.openapi(createRoute({ method: "get", path: "/state/{memberId}", request: { params: z.object({ memberId: z.string().min(1).max(100) }) }, responses: { 200: { description: "Independent source checkpoints.", content: { "application/json": { schema: QuerySyncStateSchema } } }, 401: unavailable, 503: unavailable } }), async c => {
  const db = database(c);
  const memberId = c.req.valid("param").memberId;
  const [legacy, sources] = await db.batch([
    db.prepare("SELECT message_cursor, recording_cursor, updated_at, last_error FROM query_sync_state WHERE member_id = ?").bind(memberId),
    db.prepare("SELECT state_json FROM query_source_sync WHERE member_id = ?").bind(memberId),
  ]);
  const row = legacy?.results[0] as { message_cursor: string | null; recording_cursor: string | null; updated_at: string; last_error: string | null } | undefined;
  return c.json({ ok: true as const, data: { memberId, messageCursor: row?.message_cursor ?? null, recordingCursor: row?.recording_cursor ?? null, updatedAt: row?.updated_at ?? "", lastError: row?.last_error ?? null, sources: (sources?.results ?? []).map(item => SourceSyncSchema.parse(JSON.parse((item as { state_json: string }).state_json))) } }, 200);
});

const VerifiedMediaInput = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("room"), roomId: z.string().min(1).max(200), assets: z.array(z.object({ id: z.string().min(1).max(100), occurredAt: z.string().datetime() })).max(50) }),
  z.object({ scope: z.literal("posts"), memberId: z.string().min(1).max(100), imageIds: z.array(z.string().min(1).max(100)).max(50) }),
]);
app.openapi(createRoute({ method: "post", path: "/verified-media", request: { body: { required: true, content: { "application/json": { schema: VerifiedMediaInput } } } }, responses: { 200: { description: "Previously verified originals; room assets require exact room/time, post images require the verified author.", content: { "application/json": { schema: z.object({ ok: z.literal(true), data: z.array(QueryMessageSchema) }) } } }, 401: unavailable } }), async c => {
  const db = database(c);
  const input = c.req.valid("json");
  const found = new Map<string, Record<string, unknown>>();
  const count = input.scope === "room" ? input.assets.length : input.imageIds.length;
  // Three parameters per room asset: stay below D1's 100-parameter limit.
  for (let offset = 0; offset < count; offset += 20) {
    const roomAssets = input.scope === "room" ? input.assets.slice(offset, offset + 20) : [];
    const postIds = input.scope === "posts" ? input.imageIds.slice(offset, offset + 20) : [];
    const condition = input.scope === "room"
      ? `q.room_id = ? AND (q.source_flags & 1) != 0 AND q.kind IN ('image', 'video') AND (${roomAssets.map(() => `(q.occurred_at = ? AND (EXISTS (SELECT 1 FROM query_message_images i WHERE i.message_id = q.id AND i.image_id = ?) OR EXISTS (SELECT 1 FROM query_message_videos v WHERE v.message_id = q.id AND v.video_id = ?)))`).join(" OR ")})`
      : `q.member_id = ? AND (q.source_flags & 104) != 0 AND q.kind = 'post' AND EXISTS (SELECT 1 FROM query_message_images i WHERE i.message_id = q.id AND i.image_id IN (${postIds.map(() => "?").join(", ")}))`;
    const bindings = input.scope === "room" ? [input.roomId, ...roomAssets.flatMap(asset => [asset.occurredAt, asset.id, asset.id])] : [input.memberId, ...postIds];
    const rows = await db.prepare(`SELECT q.*, m.name AS member_name, owner.name AS room_owner_name FROM query_messages q
      JOIN query_members m ON m.id = q.member_id LEFT JOIN query_members owner ON owner.id = q.room_owner_id
      WHERE q.sender_id = q.member_id AND q.parse_status = 'parsed' AND ${condition}`).bind(...bindings).all();
    for (const row of rows.results) found.set(String(row.id), row);
  }
  return c.json({ ok: true as const, data: await readMessages(drizzle(db), [...found.values()]) }, 200);
});

app.openapi(createRoute({ method: "get", path: "/catalog", request: { query: z.object({ memberId: z.string().min(1).max(100), source: z.enum(["album", "post_images"]), limit: z.coerce.number().int().min(1).max(50).default(10) }) }, responses: { 200: { description: "Private catalog entries awaiting original-message verification.", content: { "application/json": { schema: z.object({ ok: z.literal(true), data: z.array(CatalogEntrySchema) }) } } }, 401: unavailable } }), async c => {
  const { memberId, source, limit } = c.req.valid("query");
  const rows = await database(c).prepare("SELECT id, source, raw_json AS rawJson, status FROM query_catalog WHERE member_id = ? AND source = ? AND status = 'pending' ORDER BY updated_at, id LIMIT ?").bind(memberId, source, limit).all();
  return c.json({ ok: true as const, data: rows.results.map(row => CatalogEntrySchema.parse(row)) }, 200);
});

const ImageResult = z.object({ ok: z.literal(true), data: ImageAttachmentSchema.nullable() });
const imageParams = z.object({ id: z.string().min(1).max(100) });
const MediaQueueQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), afterId: z.string().max(100).optional(), since: CollectorSinceSchema.optional() });
app.openapi(createRoute({ method: "get", path: "/images", request: { query: MediaQueueQuery }, responses: { 200: { description: "Pending or failed image uploads; afterId enables stable batch pagination.", content: { "application/json": { schema: z.object({ ok: z.literal(true), data: z.array(ImageAttachmentSchema), since: z.string().nullable() }) } } }, 401: unavailable } }), async c => {
  const { limit, afterId, since: rawSince } = c.req.valid("query");
  const since = rawSince ? new Date(rawSince).toISOString() : null;
  const params: (string | number)[] = [];
  const scope = since ? "AND EXISTS (SELECT 1 FROM query_message_images link JOIN query_messages q ON q.id = link.message_id WHERE link.image_id = query_images.id AND q.occurred_at >= ? AND q.kind IN ('text', 'image', 'video', 'reply', 'post'))" : "";
  if (since) params.push(since);
  if (afterId !== undefined) params.push(afterId);
  params.push(limit);
  const rows = await database(c).prepare(`SELECT ${imageProjection} FROM query_images WHERE gallery_url IS NULL ${scope} ${afterId === undefined ? "ORDER BY updated_at, id" : "AND id > ? ORDER BY id"} LIMIT ?`).bind(...params).all();
  return c.json({ ok: true as const, data: rows.results.map(readImage), since }, 200);
});
app.openapi(createRoute({ method: "get", path: "/images/{id}", request: { params: imageParams }, responses: { 200: { description: "Image upload cache.", content: { "application/json": { schema: ImageResult } } }, 401: unavailable } }), async c => {
  const row = await database(c).prepare(`SELECT ${imageProjection} FROM query_images WHERE id = ?`).bind(c.req.valid("param").id).first();
  return c.json({ ok: true as const, data: row ? readImage(row) : null }, 200);
});
app.openapi(createRoute({ method: "post", path: "/images/{id}", request: { params: imageParams, body: { required: true, content: { "application/json": { schema: ImageAttachmentSchema } } } }, responses: { 200: { description: "Saved image progress independently of a message page.", content: { "application/json": { schema: ImageResult } } }, 400: unavailable, 401: unavailable } }), async c => {
  const image = c.req.valid("json");
  if (image.id !== c.req.valid("param").id || (image.status === "uploaded" && !image.galleryUrl)) return c.json({ ok: false as const, error: { code: "invalid_image", message: "A completed image must have a gallery URL and matching ID." } }, 400);
  await imageStatement(database(c), image, new Date().toISOString()).run();
  return c.json({ ok: true as const, data: image }, 200);
});

const VideoResult = z.object({ ok: z.literal(true), data: VideoAttachmentSchema.nullable() });
app.openapi(createRoute({ method: "get", path: "/videos", request: { query: MediaQueueQuery }, responses: { 200: { description: "Pending or failed video uploads; oversized videos are not retried.", content: { "application/json": { schema: z.object({ ok: z.literal(true), data: z.array(VideoAttachmentSchema), since: z.string().nullable() }) } } }, 401: unavailable } }), async c => {
  const { limit, afterId, since: rawSince } = c.req.valid("query");
  const since = rawSince ? new Date(rawSince).toISOString() : null;
  const params: (string | number)[] = [];
  const scope = since ? "AND EXISTS (SELECT 1 FROM query_message_videos link JOIN query_messages q ON q.id = link.message_id WHERE link.video_id = query_videos.id AND q.occurred_at >= ? AND q.kind IN ('text', 'image', 'video', 'reply', 'post'))" : "";
  if (since) params.push(since);
  if (afterId !== undefined) params.push(afterId);
  params.push(limit);
  const rows = await database(c).prepare(`SELECT ${videoProjection} FROM query_videos WHERE gallery_url IS NULL AND status IN ('pending', 'failed') ${scope} ${afterId === undefined ? "ORDER BY updated_at, id" : "AND id > ? ORDER BY id"} LIMIT ?`).bind(...params).all();
  return c.json({ ok: true as const, data: rows.results.map(readVideo), since }, 200);
});
app.openapi(createRoute({ method: "get", path: "/videos/{id}", request: { params: imageParams }, responses: { 200: { description: "Video upload cache.", content: { "application/json": { schema: VideoResult } } }, 401: unavailable } }), async c => {
  const row = await database(c).prepare(`SELECT ${videoProjection} FROM query_videos WHERE id = ?`).bind(c.req.valid("param").id).first();
  return c.json({ ok: true as const, data: row ? readVideo(row) : null }, 200);
});
app.openapi(createRoute({ method: "post", path: "/videos/{id}", request: { params: imageParams, body: { required: true, content: { "application/json": { schema: VideoAttachmentSchema } } } }, responses: { 200: { description: "Saved video upload progress.", content: { "application/json": { schema: VideoResult } } }, 400: unavailable, 401: unavailable } }), async c => {
  const video = c.req.valid("json");
  if (video.id !== c.req.valid("param").id) return c.json({ ok: false as const, error: { code: "invalid_video", message: "Video ID must match the request path." } }, 400);
  await videoStatement(database(c), video, new Date().toISOString()).run();
  return c.json({ ok: true as const, data: video }, 200);
});

app.openapi(createRoute({ method: "post", path: "/batches/{batchId}/complete", request: { params: z.object({ batchId: z.string().min(1).max(100) }), body: { required: true, content: { "application/json": { schema: BatchCompleteSchema } } } }, responses: { 200: { description: "Completed collector batch.", content: { "application/json": { schema: QueryIngestResponseSchema } } }, 401: unavailable, 404: unavailable, 503: unavailable } }), async c => {
  const input = c.req.valid("json");
  const batchId = c.req.valid("param").batchId;
  const result = await database(c).prepare("UPDATE query_batches SET status = ?, completed_at = ?, members_covered = ?, total_members = ?, error_count = ?, error_message = ? WHERE id = ?")
    .bind(input.errorCount > 0 ? "failed" : "completed", input.completedAt, input.membersCovered, input.totalMembers, input.errorCount, input.errorMessage ?? null, batchId).run();
  if (!result.meta.changes) return c.json({ ok: false as const, error: { code: "not_found", message: "Batch not found." } }, 404);
  return c.json({ ok: true as const, data: { batchId, memberId: "", messagesWritten: 0, recordingsWritten: 0 } }, 200);
});
export default app;
