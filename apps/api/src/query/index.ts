import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { HTTPException } from "hono/http-exception";
import type { SourceSync } from "@starter/shared";
import { CollectionSourceSchema, ErrorSchema, QueryMemberDetailSchema, QueryMembersSchema, QueryMessageSearchSchema, QueryOverviewSchema, QueryRankingsSchema, QueryRecordingsSchema, SourceSyncSchema } from "@starter/shared/schemas";
import type { AppEnv } from "../env";
import ingest from "./ingest";
import { readMessages as messages } from "./messages";
import { registerMeleeQuery } from "./melee";
import { registerArchivePages, publicMessageFilter, contentSourceFlags } from "./archive-pages";

const DateQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const RankingQuery = z.object({
  from: z.iso.date(), to: z.iso.date(),
  group: z.string().trim().min(1).max(100).optional(),
  team: z.string().trim().min(1).max(100).optional(),
}).refine(value => value.from <= value.to && Date.parse(value.to) - Date.parse(value.from) <= 365 * 86400_000, "Choose a date range of at most 366 days.")
  .refine(value => value.to <= previousDate(), "Statistics are available through yesterday (Asia/Shanghai).");
const MessageQuery = z.object({ q: z.string().trim().max(100).optional(), memberId: z.string().trim().max(100).optional(), before: z.string().max(600).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), kind: z.enum(["text", "image", "video", "reply", "post", "excluded", "unknown"]).optional(), source: CollectionSourceSchema.optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const unavailable = { description: "D1 profile is not configured.", content: { "application/json": { schema: ErrorSchema } } };
const app = new OpenAPIHono<AppEnv>({ defaultHook: (result, c) => { if (!result.success) return c.json({ ok: false as const, error: { code: "invalid_request", message: "Request validation failed." } }, 400); } });
app.use("*", async (c, next) => {
  if (!c.env.APP_DB) return c.json({ ok: false, error: { code: "database_not_configured", message: "Enable the D1 profile to use query data." } }, 503);
  c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  await next();
});
app.onError((error, c) => {
  let cause: unknown = error;
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
    if (/no such (?:table|column)/i.test(cause.message)) return c.json({ ok: false, error: { code: "database_not_initialized", message: "Apply D1 migrations before using query data." } }, 503);
    cause = cause.cause;
  }
  if (error instanceof HTTPException) return c.json({ ok: false, error: { code: "http_error", message: error.message } }, error.status);
  console.error(JSON.stringify({ event: "query_failed", name: error.name }));
  return c.json({ ok: false, error: { code: "internal_error", message: "Unexpected server error." } }, 500);
});
app.route("/ingest", ingest);
registerMeleeQuery(app);
registerArchivePages(app);
function database(env: AppEnv["Bindings"]) { if (!env.APP_DB) throw new Error("APP_DB binding is missing"); return drizzle(env.APP_DB); }
type Database = ReturnType<typeof database>;
type Row = Record<string, unknown>;
const publicKinds = sql.raw(publicMessageFilter);
const sourceBits = contentSourceFlags;
const projection = sql`q.*, m.name AS member_name, owner.name AS room_owner_name`;
const joins = sql`query_messages q JOIN query_members m ON m.id = q.member_id LEFT JOIN query_members owner ON owner.id = q.room_owner_id`;
function previousDate() { return new Date(Date.now() + 8 * 3600_000 - 86400_000).toISOString().slice(0, 10); }

async function sourceStates(db: Database, memberId: string): Promise<SourceSync[]> {
  const rows = await db.all<{ state_json: string }>(sql`SELECT state_json FROM query_source_sync WHERE member_id = ${memberId}`);
  return rows.map(row => SourceSyncSchema.parse(JSON.parse(row.state_json)));
}
async function coverage(db: Database) {
  const [row] = await db.all<Row>(sql`SELECT
    (SELECT COUNT(*) FROM query_members WHERE status = 'active') AS total_members,
    COUNT(DISTINCT q.member_id) AS members_covered, MIN(date(q.occurred_at, '+8 hours')) AS earliest_date, MAX(date(q.occurred_at, '+8 hours')) AS latest_date,
    (SELECT completed_at FROM query_batches WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1) AS last_batch_completed_at
    FROM query_messages q WHERE ${publicKinds}`);
  const covered = Number(row?.members_covered ?? 0);
  // Non-empty samples prove coverage, not complete history or account access.
  return { status: covered > 0 ? "partial" as const : "unavailable" as const, earliestDate: typeof row?.earliest_date === "string" ? row.earliest_date : null, latestDate: typeof row?.latest_date === "string" ? row.latest_date : null, membersCovered: covered, totalMembers: Number(row?.total_members ?? 0), lastBatchCompletedAt: typeof row?.last_batch_completed_at === "string" ? row.last_batch_completed_at : null };
}
const memberProjection = (date?: string) => {
  const through = date ? sql`date(q.occurred_at, '+8 hours') <= ${date}` : sql`1 = 1`;
  return sql`m.id, m.name, m.pinyin, m.group_name, m.team,
  (SELECT COUNT(*) FROM query_messages q WHERE q.member_id = m.id AND ${publicKinds} AND ${through}) AS messages,
  (SELECT COUNT(DISTINCT date(q.occurred_at, '+8 hours')) FROM query_messages q WHERE q.member_id = m.id AND ${publicKinds} AND ${through}) AS active_days,
  (SELECT COUNT(DISTINCT link.image_id) FROM query_message_images link JOIN query_messages q ON q.id = link.message_id WHERE q.member_id = m.id AND ${publicKinds} AND ${through}) AS images,
  (SELECT COUNT(*) FROM query_messages q WHERE q.member_id = m.id AND q.kind = 'reply' AND ${through}) AS replies,
  (SELECT MAX(q.occurred_at) FROM query_messages q WHERE q.member_id = m.id AND ${publicKinds} AND ${through}) AS latest_message_at`;
};
const memberData = (row: Row) => ({ id: String(row.id), name: String(row.name), pinyin: row.pinyin as string | null, groupName: String(row.group_name), team: row.team as string | null, messages: Number(row.messages), activeDays: Number(row.active_days), images: Number(row.images), replies: Number(row.replies), recordings: 0, latestMessageAt: row.latest_message_at as string | null });
// Every public attachment belongs to a public message. Existence keeps text-only
// members and uses cumulative archives, independent of the ranking date range.
const memberHasContent = sql`EXISTS (SELECT 1 FROM query_messages q WHERE q.member_id = m.id AND ${publicKinds})`;

app.openapi(createRoute({ method: "get", path: "/overview", request: { query: DateQuery }, responses: { 200: { description: "Daily text/image statistics (Asia/Shanghai).", content: { "application/json": { schema: QueryOverviewSchema } } }, 503: unavailable } }), async c => {
  const db = database(c.env);
  const date = c.req.valid("query").date ?? previousDate();
  const [totalRows, breakdown, activity, ranking, recent, imageRows, cover] = await Promise.all([
    db.all<Row>(sql`SELECT COUNT(*) AS messages, COUNT(DISTINCT q.member_id) AS active_members, COUNT(CASE WHEN q.kind = 'reply' THEN 1 END) AS replies,
      COUNT(CASE WHEN EXISTS (SELECT 1 FROM query_message_images link WHERE link.message_id = q.id) THEN 1 END) AS image_messages
      FROM query_messages q WHERE ${publicKinds} AND date(q.occurred_at, '+8 hours') = ${date}`),
    db.all<Row>(sql`SELECT type, COUNT(*) AS count FROM query_messages q WHERE ${publicKinds} AND date(q.occurred_at, '+8 hours') = ${date} GROUP BY type ORDER BY count DESC`),
    db.all<Row>(sql`SELECT date(q.occurred_at, '+8 hours') AS date, COUNT(*) AS count FROM query_messages q WHERE ${publicKinds} AND date(q.occurred_at, '+8 hours') BETWEEN date(${date}, '-13 day') AND ${date} GROUP BY date ORDER BY date`),
    db.all<Row>(sql`SELECT m.id AS member_id, m.name AS member_name, m.group_name, m.team, COUNT(q.id) AS messages FROM query_members m JOIN query_messages q ON q.member_id = m.id WHERE ${publicKinds} AND date(q.occurred_at, '+8 hours') = ${date} GROUP BY m.id ORDER BY messages DESC, m.name LIMIT 20`),
    db.all<Row>(sql`SELECT ${projection} FROM ${joins} WHERE ${publicKinds} AND date(q.occurred_at, '+8 hours') = ${date} ORDER BY q.occurred_at DESC, q.id DESC LIMIT 10`),
    db.all<Row>(sql`SELECT COUNT(DISTINCT link.image_id) AS images FROM query_message_images link JOIN query_messages q ON q.id = link.message_id WHERE ${publicKinds} AND date(q.occurred_at, '+8 hours') = ${date}`),
    coverage(db),
  ]);
  const totals = totalRows[0];
  return c.json({ ok: true as const, data: { date, totals: { messages: Number(totals?.messages ?? 0), activeMembers: Number(totals?.active_members ?? 0), images: Number(imageRows[0]?.images ?? 0), imageMessages: Number(totals?.image_messages ?? 0), replies: Number(totals?.replies ?? 0), recordings: 0, danmaku: 0 },
    typeBreakdown: breakdown.map(row => ({ type: String(row.type), count: Number(row.count) })), dailyActivity: activity.map(row => ({ date: String(row.date), count: Number(row.count) })),
    ranking: ranking.map(row => ({ memberId: String(row.member_id), memberName: String(row.member_name), groupName: String(row.group_name), team: row.team as string | null, messages: Number(row.messages), activeDays: 1 })), recentMessages: await messages(db, recent) }, coverage: cover }, 200);
});
app.openapi(createRoute({ method: "get", path: "/rankings", request: { query: RankingQuery }, responses: {
  200: { description: "Saved member content within an inclusive Beijing-time date range. Coverage does not imply complete history.", content: { "application/json": { schema: QueryRankingsSchema } } },
  400: { description: "Invalid date range or filter.", content: { "application/json": { schema: ErrorSchema } } }, 503: unavailable,
} }), async c => {
  const db = database(c.env);
  const { from, to, group, team } = c.req.valid("query");
  // Filter timestamps directly so the existing author/time index remains usable.
  const start = new Date(`${from}T00:00:00+08:00`).toISOString();
  const end = new Date(Date.parse(`${to}T00:00:00+08:00`) + 86400_000).toISOString();
  const inRange = sql`${publicKinds} AND q.occurred_at >= ${start} AND q.occurred_at < ${end}`;
  const conditions = [sql`m.status = 'active'`, memberHasContent];
  if (group) conditions.push(sql`m.group_name = ${group}`);
  if (team) conditions.push(sql`m.team = ${team}`);
  const memberScope = sql.join(conditions, sql` AND `);
  const scope = sql`${inRange} AND ${memberScope}`;
  const [rows, imageRows, activity, breakdown, recent, directory, cover] = await Promise.all([
    db.all<Row>(sql`SELECT m.id, m.name, m.pinyin, m.group_name, m.team, COUNT(q.id) AS messages,
      f.followers, f.observed_at AS followers_observed_at,
      COUNT(DISTINCT date(q.occurred_at, '+8 hours')) AS active_days,
      SUM(CASE WHEN q.kind = 'reply' THEN 1 ELSE 0 END) AS replies, MAX(q.occurred_at) AS latest_message_at,
      (SELECT COUNT(DISTINCT link.image_id) FROM query_message_images link JOIN query_messages q ON q.id = link.message_id
        WHERE q.member_id = m.id AND ${inRange}) AS images
      FROM query_members m LEFT JOIN query_messages q ON m.id = q.member_id AND ${inRange}
      LEFT JOIN query_follower_snapshots f ON f.member_id = m.id AND f.observed_at =
        (SELECT MAX(latest.observed_at) FROM query_follower_snapshots latest WHERE latest.member_id = m.id)
      WHERE ${memberScope} GROUP BY m.id HAVING COUNT(q.id) > 0 OR f.followers IS NOT NULL
      ORDER BY messages DESC, m.name, m.id`),
    db.all<Row>(sql`SELECT COUNT(DISTINCT link.image_id) AS images FROM query_message_images link
      JOIN query_messages q ON q.id = link.message_id JOIN query_members m ON m.id = q.member_id WHERE ${scope}`),
    db.all<Row>(sql`SELECT date(q.occurred_at, '+8 hours') AS date, COUNT(*) AS count FROM query_messages q
      JOIN query_members m ON m.id = q.member_id WHERE ${scope} GROUP BY date ORDER BY date`),
    db.all<Row>(sql`SELECT q.type, COUNT(*) AS count FROM query_messages q JOIN query_members m ON m.id = q.member_id
      WHERE ${scope} GROUP BY q.type ORDER BY count DESC, q.type`),
    db.all<Row>(sql`SELECT ${projection} FROM ${joins} WHERE ${scope} ORDER BY q.occurred_at DESC, q.id DESC LIMIT 4`),
    db.all<Row>(sql`SELECT DISTINCT group_name, team FROM query_members m WHERE m.status = 'active' AND ${memberHasContent} ORDER BY group_name, team`),
    coverage(db),
  ]);
  const members = rows.map(row => ({ ...memberData(row), followers: row.followers == null ? null : Number(row.followers), followersObservedAt: row.followers_observed_at as string | null }));
  const observations = members.flatMap(member => member.followersObservedAt ? [member.followersObservedAt] : []).toSorted();
  return c.json({ ok: true as const, data: {
    from, to,
    totals: { messages: members.reduce((sum, member) => sum + member.messages, 0), activeMembers: members.filter(member => member.messages > 0).length,
      images: Number(imageRows[0]?.images ?? 0), replies: members.reduce((sum, member) => sum + member.replies, 0) },
    members, directory: directory.map(row => ({ groupName: String(row.group_name), team: row.team as string | null })),
    followersCoverage: { membersCovered: observations.length, earliestObservedAt: observations[0] ?? null, latestObservedAt: observations.at(-1) ?? null },
    dailyActivity: activity.map(row => ({ date: String(row.date), count: Number(row.count) })),
    typeBreakdown: breakdown.map(row => ({ type: String(row.type), count: Number(row.count) })),
    recentMessages: await messages(db, recent),
  }, coverage: cover }, 200);
});
app.openapi(createRoute({ method: "get", path: "/members", request: { query: DateQuery }, responses: { 200: { description: "Member archive statistics.", content: { "application/json": { schema: QueryMembersSchema } } }, 503: unavailable } }), async c => {
  const db = database(c.env);
  const date = c.req.valid("query").date;
  const rows = await db.all<Row>(sql`SELECT ${memberProjection(date)} FROM query_members m WHERE m.status = 'active' AND ${memberHasContent} ORDER BY messages DESC, m.name`);
  return c.json({ ok: true as const, data: rows.map(memberData), coverage: await coverage(db) }, 200);
});
app.openapi(createRoute({ method: "get", path: "/members/{id}", request: { params: z.object({ id: z.string().min(1).max(100) }), query: DateQuery }, responses: { 200: { description: "Member timeline and source status.", content: { "application/json": { schema: QueryMemberDetailSchema } } }, 404: unavailable, 503: unavailable } }), async c => {
  const db = database(c.env);
  const id = c.req.valid("param").id;
  const date = c.req.valid("query").date ?? previousDate();
  const rows = await db.all<Row>(sql`SELECT ${memberProjection(date)} FROM query_members m WHERE m.id = ${id}`);
  if (!rows[0]) return c.json({ ok: false as const, error: { code: "not_found", message: "Member not found." } }, 404);
  const [activity, recent, sync, cover] = await Promise.all([
    db.all<Row>(sql`SELECT date(q.occurred_at, '+8 hours') AS date, COUNT(*) AS count FROM query_messages q WHERE q.member_id = ${id} AND ${publicKinds} AND date(q.occurred_at, '+8 hours') BETWEEN date(${date}, '-13 day') AND ${date} GROUP BY date ORDER BY date`),
    db.all<Row>(sql`SELECT ${projection} FROM ${joins} WHERE q.member_id = ${id} AND ${publicKinds} AND date(q.occurred_at, '+8 hours') <= ${date} ORDER BY q.occurred_at DESC, q.id DESC LIMIT 20`), sourceStates(db, id), coverage(db),
  ]);
  return c.json({ ok: true as const, data: { ...memberData(rows[0]), dailyActivity: activity.map(row => ({ date: String(row.date), count: Number(row.count) })), recentMessages: await messages(db, recent), sync }, coverage: cover }, 200);
});
app.openapi(createRoute({ method: "get", path: "/messages", request: { query: MessageQuery }, responses: { 200: { description: "Search text, questions, images and public posts.", content: { "application/json": { schema: QueryMessageSearchSchema } } }, 400: unavailable, 503: unavailable } }), async c => {
  const db = database(c.env);
  const { q, memberId, before, limit, kind, source, from, to } = c.req.valid("query");
  let boundary: { at: string; id: string } | null = null;
  if (before) {
    try { const value: unknown = JSON.parse(before); const parsed = z.object({ at: z.string().datetime(), id: z.string().min(1).max(200) }).safeParse(value); if (!parsed.success) throw new Error(); boundary = parsed.data; }
    catch { return c.json({ ok: false as const, error: { code: "invalid_cursor", message: "Invalid message cursor." } }, 400); }
  }
  const conditions = [kind === "excluded" || kind === "unknown" ? sql`q.kind = ${kind}` : publicKinds];
  if (q) conditions.push(sql`(q.text LIKE '%' || ${q} || '%' OR q.question LIKE '%' || ${q} || '%' OR q.answer LIKE '%' || ${q} || '%')`);
  if (memberId) conditions.push(sql`q.member_id = ${memberId}`);
  if (kind === "image") conditions.push(sql`EXISTS (SELECT 1 FROM query_message_images link WHERE link.message_id = q.id)`);
  else if (kind && !["excluded", "unknown"].includes(kind)) conditions.push(sql`q.kind = ${kind}`);
  if (source) conditions.push(sql`(q.source_flags & ${sourceBits[source]}) != 0`);
  if (from) conditions.push(sql`date(q.occurred_at, '+8 hours') >= ${from}`);
  if (to) conditions.push(sql`date(q.occurred_at, '+8 hours') <= ${to}`);
  if (boundary) conditions.push(sql`(q.occurred_at < ${boundary.at} OR (q.occurred_at = ${boundary.at} AND q.id < ${boundary.id}))`);
  const rows = await db.all<Row>(sql`SELECT ${projection} FROM ${joins} WHERE ${sql.join(conditions, sql` AND `)} ORDER BY q.occurred_at DESC, q.id DESC LIMIT ${limit + 1}`);
  const hasMore = rows.length > limit;
  const data = await messages(db, rows.slice(0, limit));
  const last = data.at(-1);
  return c.json({ ok: true as const, data, nextCursor: hasMore && last ? JSON.stringify({ at: last.occurredAt, id: last.id }) : null, coverage: await coverage(db) }, 200);
});
// Read-only access to historical metadata is retained; no collection or UI entry.
app.openapi(createRoute({ method: "get", path: "/recordings", request: { query: DateQuery }, responses: { 200: { description: "Legacy recording metadata (collection disabled).", content: { "application/json": { schema: QueryRecordingsSchema } } }, 503: unavailable } }), async c => {
  const db = database(c.env);
  const date = c.req.valid("query").date ?? previousDate();
  const rows = await db.all<Row>(sql`SELECT r.*, m.name AS member_name FROM query_recordings r JOIN query_members m ON m.id = r.member_id WHERE date(r.occurred_at, '+8 hours') <= ${date} ORDER BY r.occurred_at DESC LIMIT 100`);
  return c.json({ ok: true as const, data: rows.map(row => ({ id: String(row.id), memberId: String(row.member_id), memberName: String(row.member_name), title: row.title as string | null, occurredAt: String(row.occurred_at), durationSeconds: row.duration_seconds as number | null, danmakuCount: Number(row.danmaku_count), danmakuStatus: row.danmaku_status as "pending" | "parsed" | "failed" })), coverage: await coverage(db) }, 200);
});
export default app;
