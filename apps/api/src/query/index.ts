import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import {
  ErrorSchema,
  QueryMemberDetailSchema,
  QueryMembersSchema,
  QueryMessageSearchSchema,
  QueryOverviewSchema,
  QueryRecordingsSchema,
} from "@starter/shared/schemas";
import { drizzle } from "drizzle-orm/d1";
import ingest from "./ingest";

const DateQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const MessageQuery = z.object({
  q: z.string().trim().max(100).optional(),
  memberId: z.string().trim().max(80).optional(),
  before: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const unavailable = { description: "D1 profile is not configured.", content: { "application/json": { schema: ErrorSchema } } };

const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (!result.success) return c.json({ ok: false as const, error: { code: "invalid_request", message: "Request validation failed." } }, 400);
  },
});

app.use("*", async (c, next) => {
  if (!c.env.APP_DB) return c.json({ ok: false, error: { code: "database_not_configured", message: "Enable the D1 profile to use query data." } }, 503);
  c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  await next();
});

app.onError((error, c) => {
  let cause: unknown = error;
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
    if (/no such table/i.test(cause.message)) return c.json({ ok: false, error: { code: "database_not_initialized", message: "Apply D1 migrations before using query data." } }, 503);
    cause = cause.cause;
  }
  if (error instanceof HTTPException) return c.json({ ok: false, error: { code: "http_error", message: error.message } }, error.status);
  console.error(error);
  return c.json({ ok: false, error: { code: "internal_error", message: "Unexpected server error." } }, 500);
});

app.route("/ingest", ingest);

function database(env: AppEnv["Bindings"]) {
  if (!env.APP_DB) throw new Error("APP_DB binding is missing");
  return drizzle(env.APP_DB);
}

function previousDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function coverage(db: ReturnType<typeof drizzle>) {
  const [row] = await db.all(sql`SELECT
    (SELECT COUNT(*) FROM query_members WHERE status = 'active') AS total_members,
    (SELECT COUNT(DISTINCT member_id) FROM query_messages) AS members_covered,
    (SELECT MIN(substr(occurred_at, 1, 10)) FROM query_messages) AS earliest_date,
    (SELECT MAX(substr(occurred_at, 1, 10)) FROM query_messages) AS latest_date,
    (SELECT completed_at FROM query_batches WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1) AS last_batch_completed_at`);
  const item = row as { total_members?: number; members_covered?: number; earliest_date?: string | null; latest_date?: string | null; last_batch_completed_at?: string | null } | undefined;
  const totalMembers = Number(item?.total_members ?? 0);
  const membersCovered = Number(item?.members_covered ?? 0);
  const hasCompletedBatch = Boolean(item?.last_batch_completed_at);
  return {
    status: hasCompletedBatch && totalMembers > 0 && membersCovered >= totalMembers ? "complete" as const : membersCovered > 0 ? "partial" as const : "unavailable" as const,
    earliestDate: item?.earliest_date ?? null,
    latestDate: item?.latest_date ?? null,
    membersCovered,
    totalMembers,
    lastBatchCompletedAt: item?.last_batch_completed_at ?? null,
  };
}

app.openapi(createRoute({ method: "get", path: "/overview", request: { query: DateQuery }, responses: { 200: { description: "Daily overview statistics.", content: { "application/json": { schema: QueryOverviewSchema } } }, 503: unavailable } }), async (c) => {
  const db = database(c.env);
  const date = c.req.valid("query").date ?? previousDate();
  const [totalsRow] = await db.all(sql`SELECT COUNT(*) AS messages, COUNT(DISTINCT member_id) AS active_members FROM query_messages WHERE substr(occurred_at, 1, 10) = ${date}`);
  const [recordingsRow] = await db.all(sql`SELECT COUNT(*) AS recordings, COALESCE(SUM(danmaku_count), 0) AS danmaku FROM query_recordings WHERE substr(occurred_at, 1, 10) = ${date}`);
  const breakdownRows = await db.all(sql`SELECT type, COUNT(*) AS count FROM query_messages WHERE substr(occurred_at, 1, 10) = ${date} GROUP BY type ORDER BY count DESC`);
  const activityRows = await db.all(sql`SELECT substr(occurred_at, 1, 10) AS date, COUNT(*) AS count FROM query_messages WHERE occurred_at >= date(${date}, '-13 day') AND occurred_at < date(${date}, '+1 day') GROUP BY date ORDER BY date`);
  const rankingRows = await db.all(sql`SELECT m.id AS member_id, m.name AS member_name, m.group_name, m.team, COUNT(q.id) AS messages, COUNT(DISTINCT substr(q.occurred_at, 1, 10)) AS active_days FROM query_members m LEFT JOIN query_messages q ON q.member_id = m.id AND substr(q.occurred_at, 1, 10) = ${date} GROUP BY m.id ORDER BY messages DESC, m.name LIMIT 20`);
  const messageRows = await db.all(sql`SELECT q.id, q.member_id, m.name AS member_name, q.type, q.text, q.occurred_at, q.sender_name, q.sender_type FROM query_messages q JOIN query_members m ON m.id = q.member_id WHERE substr(q.occurred_at, 1, 10) = ${date} ORDER BY q.occurred_at DESC LIMIT 10`);
  const totals = totalsRow as { messages?: number; active_members?: number } | undefined;
  const recordings = recordingsRow as { recordings?: number; danmaku?: number } | undefined;
  return c.json({ ok: true as const, data: {
    date,
    totals: { messages: Number(totals?.messages ?? 0), activeMembers: Number(totals?.active_members ?? 0), recordings: Number(recordings?.recordings ?? 0), danmaku: Number(recordings?.danmaku ?? 0) },
    typeBreakdown: breakdownRows.map((row) => ({ type: String((row as { type: string }).type), count: Number((row as { count: number }).count) })),
    dailyActivity: activityRows.map((row) => ({ date: String((row as { date: string }).date), count: Number((row as { count: number }).count) })),
    ranking: rankingRows.map((row) => { const item = row as { member_id: string; member_name: string; group_name: string; team: string | null; messages: number; active_days: number }; return { memberId: item.member_id, memberName: item.member_name, groupName: item.group_name, team: item.team, messages: Number(item.messages), activeDays: Number(item.active_days) }; }),
    recentMessages: messageRows.map((row) => { const item = row as { id: string; member_id: string; member_name: string; type: string; text: string | null; occurred_at: string; sender_name: string | null; sender_type: string | null }; return { id: item.id, memberId: item.member_id, memberName: item.member_name, type: item.type, text: item.text, occurredAt: item.occurred_at, senderName: item.sender_name, senderType: item.sender_type }; }),
  }, coverage: await coverage(db) }, 200);
});

app.openapi(createRoute({ method: "get", path: "/members", request: { query: DateQuery }, responses: { 200: { description: "Members with accumulated statistics.", content: { "application/json": { schema: QueryMembersSchema } } }, 503: unavailable } }), async (c) => {
  const db = database(c.env);
  const date = c.req.valid("query").date ?? previousDate();
  const rows = await db.all(sql`SELECT m.id, m.name, m.pinyin, m.group_name, m.team,
    (SELECT COUNT(*) FROM query_messages q WHERE q.member_id = m.id AND substr(q.occurred_at, 1, 10) <= ${date}) AS messages,
    (SELECT COUNT(DISTINCT substr(q.occurred_at, 1, 10)) FROM query_messages q WHERE q.member_id = m.id AND substr(q.occurred_at, 1, 10) <= ${date}) AS active_days,
    (SELECT COUNT(*) FROM query_recordings r WHERE r.member_id = m.id AND substr(r.occurred_at, 1, 10) <= ${date}) AS recordings,
    (SELECT MAX(q.occurred_at) FROM query_messages q WHERE q.member_id = m.id AND substr(q.occurred_at, 1, 10) <= ${date}) AS latest_message_at
    FROM query_members m WHERE m.status = 'active' ORDER BY messages DESC, m.name`);
  return c.json({ ok: true as const, data: rows.map((row) => { const item = row as { id: string; name: string; pinyin: string | null; group_name: string; team: string | null; messages: number; active_days: number; recordings: number; latest_message_at: string | null }; return { id: item.id, name: item.name, pinyin: item.pinyin, groupName: item.group_name, team: item.team, messages: Number(item.messages), activeDays: Number(item.active_days), recordings: Number(item.recordings), latestMessageAt: item.latest_message_at }; }), coverage: await coverage(db) }, 200);
});

app.openapi(createRoute({ method: "get", path: "/members/{id}", request: { params: z.object({ id: z.string().min(1).max(80) }), query: DateQuery }, responses: { 200: { description: "Member detail.", content: { "application/json": { schema: QueryMemberDetailSchema } } }, 404: { content: { "application/json": { schema: ErrorSchema } }, description: "Member not found." }, 503: unavailable } }), async (c) => {
  const db = database(c.env);
  const id = c.req.valid("param").id;
  const date = c.req.valid("query").date ?? previousDate();
  const [row] = await db.all(sql`SELECT m.id, m.name, m.pinyin, m.group_name, m.team,
    (SELECT COUNT(*) FROM query_messages q WHERE q.member_id = m.id AND substr(q.occurred_at, 1, 10) <= ${date}) AS messages,
    (SELECT COUNT(DISTINCT substr(q.occurred_at, 1, 10)) FROM query_messages q WHERE q.member_id = m.id AND substr(q.occurred_at, 1, 10) <= ${date}) AS active_days,
    (SELECT COUNT(*) FROM query_recordings r WHERE r.member_id = m.id AND substr(r.occurred_at, 1, 10) <= ${date}) AS recordings,
    (SELECT MAX(q.occurred_at) FROM query_messages q WHERE q.member_id = m.id AND substr(q.occurred_at, 1, 10) <= ${date}) AS latest_message_at
    FROM query_members m WHERE m.id = ${id}`);
  if (!row) return c.json({ ok: false as const, error: { code: "not_found", message: "Member not found." } }, 404);
  const item = row as { id: string; name: string; pinyin: string | null; group_name: string; team: string | null; messages: number; active_days: number; recordings: number; latest_message_at: string | null };
  const activity = await db.all(sql`SELECT substr(occurred_at, 1, 10) AS date, COUNT(*) AS count FROM query_messages WHERE member_id = ${id} AND occurred_at >= date(${date}, '-13 day') AND occurred_at < date(${date}, '+1 day') GROUP BY date ORDER BY date`);
  const recent = await db.all(sql`SELECT q.id, q.member_id, m.name AS member_name, q.type, q.text, q.occurred_at, q.sender_name, q.sender_type FROM query_messages q JOIN query_members m ON m.id = q.member_id WHERE q.member_id = ${id} ORDER BY q.occurred_at DESC LIMIT 20`);
  return c.json({ ok: true as const, data: { id: item.id, name: item.name, pinyin: item.pinyin, groupName: item.group_name, team: item.team, messages: Number(item.messages), activeDays: Number(item.active_days), recordings: Number(item.recordings), latestMessageAt: item.latest_message_at, dailyActivity: activity.map((entry) => ({ date: String((entry as { date: string }).date), count: Number((entry as { count: number }).count) })), recentMessages: recent.map((entry) => { const message = entry as { id: string; member_id: string; member_name: string; type: string; text: string | null; occurred_at: string; sender_name: string | null; sender_type: string | null }; return { id: message.id, memberId: message.member_id, memberName: message.member_name, type: message.type, text: message.text, occurredAt: message.occurred_at, senderName: message.sender_name, senderType: message.sender_type }; }) }, coverage: await coverage(db) }, 200);
});

app.openapi(createRoute({ method: "get", path: "/messages", request: { query: MessageQuery }, responses: { 200: { description: "Search messages.", content: { "application/json": { schema: QueryMessageSearchSchema } } }, 503: unavailable } }), async (c) => {
  const db = database(c.env);
  const { q, memberId, before, limit } = c.req.valid("query");
  const rows = await db.all(sql`SELECT q.id, q.member_id, m.name AS member_name, q.type, q.text, q.occurred_at, q.sender_name, q.sender_type FROM query_messages q JOIN query_members m ON m.id = q.member_id WHERE (${q ?? null} IS NULL OR q.text LIKE '%' || ${q ?? null} || '%') AND (${memberId ?? null} IS NULL OR q.member_id = ${memberId ?? null}) AND (${before ?? null} IS NULL OR q.occurred_at < ${before ?? null}) ORDER BY q.occurred_at DESC LIMIT ${limit}`);
  const data = rows.map((entry) => { const item = entry as { id: string; member_id: string; member_name: string; type: string; text: string | null; occurred_at: string; sender_name: string | null; sender_type: string | null }; return { id: item.id, memberId: item.member_id, memberName: item.member_name, type: item.type, text: item.text, occurredAt: item.occurred_at, senderName: item.sender_name, senderType: item.sender_type }; });
  return c.json({ ok: true as const, data, nextCursor: data.at(-1)?.occurredAt ?? null, coverage: await coverage(db) }, 200);
});

app.openapi(createRoute({ method: "get", path: "/recordings", request: { query: DateQuery }, responses: { 200: { description: "Recordings and danmaku status.", content: { "application/json": { schema: QueryRecordingsSchema } } }, 503: unavailable } }), async (c) => {
  const db = database(c.env);
  const date = c.req.valid("query").date ?? previousDate();
  const rows = await db.all(sql`SELECT r.id, r.member_id, m.name AS member_name, r.title, r.occurred_at, r.duration_seconds, r.danmaku_count, r.danmaku_status FROM query_recordings r JOIN query_members m ON m.id = r.member_id WHERE substr(r.occurred_at, 1, 10) <= ${date} ORDER BY r.occurred_at DESC`);
  return c.json({ ok: true as const, data: rows.map((entry) => { const item = entry as { id: string; member_id: string; member_name: string; title: string | null; occurred_at: string; duration_seconds: number | null; danmaku_count: number; danmaku_status: "pending" | "parsed" | "failed" }; return { id: item.id, memberId: item.member_id, memberName: item.member_name, title: item.title, occurredAt: item.occurred_at, durationSeconds: item.duration_seconds, danmakuCount: Number(item.danmaku_count), danmakuStatus: item.danmaku_status }; }), coverage: await coverage(db) }, 200);
});

export default app;
