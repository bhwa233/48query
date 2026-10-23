import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import { CollectionSourceSchema, ErrorSchema, QueryActivitySchema, QueryContentTotalsSchema, QueryImagePageSchema, QueryMessagePageSchema } from "@starter/shared/schemas";
import type { CollectionSource } from "@starter/shared";
import type { AppEnv } from "../env";
import { readMessages } from "./messages";

export const publicMessageFilter = "q.kind IN ('text', 'image', 'video', 'reply', 'post') AND q.parse_status = 'parsed'";
export const contentSourceFlags: Record<CollectionSource, number> = { room: 1, album: 2, essence: 4, posts: 8, post_images: 16, weibo: 32, room_posts: 64 };
const filters = z.object({ q: z.string().trim().max(100).optional(), memberId: z.string().trim().min(1).max(100).optional(), kind: z.enum(["text", "image", "video", "reply", "post"]).optional(), source: CollectionSourceSchema.optional(), from: z.iso.date().optional(), to: z.iso.date().optional() });
const pageQuery = (maximum: number, initial: number) => filters.extend({ page: z.coerce.number().int().min(1).max(1_000_000).default(1), pageSize: z.coerce.number().int().min(1).max(maximum).default(initial) }).refine(value => !value.from || !value.to || value.from <= value.to, "The end date must follow the start date.");
const totalsQuery = filters.refine(value => !value.from || !value.to || value.from <= value.to, "The end date must follow the start date.");
const activityQuery = filters.omit({ from: true }).extend({ year: z.coerce.number().int().min(1970).max(9999).optional(), group: z.string().trim().max(100).optional(), team: z.string().trim().max(100).optional() });
const failure = { description: "Invalid query or unavailable archive.", content: { "application/json": { schema: ErrorSchema } } };
type Filter = z.infer<typeof filters> & { group?: string; team?: string };
type Row = Record<string, unknown>;
const joins = "query_messages q JOIN query_members m ON m.id = q.member_id LEFT JOIN query_members owner ON owner.id = q.room_owner_id";

// The existing cursor reader remains available to ingestion/legacy consumers.
// These public views use bound parameters and native D1 batches so each page's
// total and rows are read in one transaction, including an out-of-range page.
function scope(input: Filter) {
  const clauses = [publicMessageFilter];
  const values: (string | number)[] = [];
  const add = (condition: string, value: string | number) => { clauses.push(condition); values.push(value); };
  if (input.q) { clauses.push("(instr(lower(COALESCE(q.text, '')), lower(?)) > 0 OR instr(lower(COALESCE(q.question, '')), lower(?)) > 0 OR instr(lower(COALESCE(q.answer, '')), lower(?)) > 0)"); values.push(input.q, input.q, input.q); }
  if (input.memberId) add("q.member_id = ?", input.memberId);
  if (input.kind === "image") clauses.push("EXISTS (SELECT 1 FROM query_message_images link WHERE link.message_id = q.id)");
  else if (input.kind) add("q.kind = ?", input.kind);
  if (input.source) add("(q.source_flags & ?) != 0", contentSourceFlags[input.source]);
  if (input.from) add("q.occurred_at >= ?", new Date(`${input.from}T00:00:00+08:00`).toISOString());
  if (input.to) add("q.occurred_at < ?", new Date(Date.parse(`${input.to}T00:00:00+08:00`) + 86400_000).toISOString());
  if (input.group) add("m.group_name = ?", input.group);
  if (input.team) add("m.team = ?", input.team);
  return { where: clauses.join(" AND "), values };
}

function pagination(page: number, pageSize: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page: Math.min(page, totalPages), pageSize, total, totalPages };
}

export function registerArchivePages(app: OpenAPIHono<AppEnv>) {
  app.openapi(createRoute({ method: "get", path: "/message-pages", request: { query: pageQuery(100, 20) }, responses: { 200: { description: "Directly addressable message page, newest first with ID tie-breaking.", content: { "application/json": { schema: QueryMessagePageSchema } } }, 400: failure, 503: failure } }), async c => {
    const input = c.req.valid("query"), db = c.env.APP_DB!, filter = scope(input);
    const base = `FROM ${joins} WHERE ${filter.where}`;
    const count = `SELECT COUNT(*) AS total ${base}`;
    const result = await db.batch<Row>([
      db.prepare(count).bind(...filter.values),
      db.prepare(`SELECT q.*, m.name AS member_name, owner.name AS room_owner_name ${base} ORDER BY q.occurred_at DESC, q.id DESC LIMIT ? OFFSET (MIN(?, MAX(1, ((${count}) + ? - 1) / ?)) - 1) * ?`).bind(...filter.values, input.pageSize, input.page, ...filter.values, input.pageSize, input.pageSize, input.pageSize),
    ]);
    const total = Number(result[0]!.results[0]?.total ?? 0);
    const data = await readMessages(drizzle(db), result[1]!.results);
    return c.json({ ok: true as const, data, pagination: pagination(input.page, input.pageSize, total) }, 200);
  });

  app.openapi(createRoute({ method: "get", path: "/image-pages", request: { query: pageQuery(120, 30) }, responses: { 200: { description: "Distinct image page; repeated attachments choose their newest matching message.", content: { "application/json": { schema: QueryImagePageSchema } } }, 400: failure, 503: failure } }), async c => {
    const input = c.req.valid("query"), db = c.env.APP_DB!, filter = scope(input);
    const cte = `WITH ranked AS (SELECT link.image_id, link.message_id, link.position, q.occurred_at,
      ROW_NUMBER() OVER (PARTITION BY link.image_id ORDER BY q.occurred_at DESC, q.id DESC, link.position) AS occurrence
      FROM ${joins} JOIN query_message_images link ON link.message_id = q.id WHERE ${filter.where}), images AS (SELECT * FROM ranked WHERE occurrence = 1)`;
    const result = await db.batch<Row>([
      db.prepare(`${cte} SELECT COUNT(*) AS total FROM images`).bind(...filter.values),
      db.prepare(`${cte} SELECT * FROM images ORDER BY occurred_at DESC, message_id DESC, position, image_id LIMIT ? OFFSET (MIN(?, MAX(1, ((SELECT COUNT(*) FROM images) + ? - 1) / ?)) - 1) * ?`).bind(...filter.values, input.pageSize, input.page, input.pageSize, input.pageSize, input.pageSize),
    ]);
    const total = Number(result[0]!.results[0]?.total ?? 0);
    const ids = [...new Set(result[1]!.results.map(row => String(row.message_id)))];
    const orm = drizzle(db);
    const messages = new Map<string, Awaited<ReturnType<typeof readMessages>>[number]>();
    // D1 permits 100 bound parameters per statement. A 120-image page can span
    // 120 parent messages, so bound both parent and attachment reads in chunks.
    for (let offset = 0; offset < ids.length; offset += 80) {
      const batch = ids.slice(offset, offset + 80);
      const rows = await orm.all<Row>(sql`SELECT q.*, m.name AS member_name, owner.name AS room_owner_name FROM query_messages q JOIN query_members m ON m.id = q.member_id LEFT JOIN query_members owner ON owner.id = q.room_owner_id WHERE q.id IN (${sql.join(batch.map(id => sql`${id}`), sql`, `)})`);
      for (const message of await readMessages(orm, rows)) messages.set(message.id, message);
    }
    const data = result[1]!.results.flatMap(row => {
      const message = messages.get(String(row.message_id)), image = message?.images.find(item => item.id === row.image_id);
      return message && image ? [{ image, message }] : [];
    });
    return c.json({ ok: true as const, data, pagination: pagination(input.page, input.pageSize, total) }, 200);
  });

  app.openapi(createRoute({ method: "get", path: "/content-summary", request: { query: totalsQuery }, responses: { 200: { description: "Message and distinct-image totals for the selected content filters.", content: { "application/json": { schema: QueryContentTotalsSchema } } }, 400: failure, 503: failure } }), async c => {
    const filter = scope(c.req.valid("query"));
    const row = await c.env.APP_DB!.prepare(`SELECT COUNT(DISTINCT q.id) AS messages, COUNT(DISTINCT link.image_id) AS images, COUNT(DISTINCT CASE WHEN q.kind = 'reply' THEN q.id END) AS replies FROM ${joins} LEFT JOIN query_message_images link ON link.message_id = q.id WHERE ${filter.where}`).bind(...filter.values).first<{ messages: number; images: number; replies: number }>();
    return c.json({ ok: true as const, data: row ?? { messages: 0, images: 0, replies: 0 } }, 200);
  });

  app.openapi(createRoute({ method: "get", path: "/activity", request: { query: activityQuery }, responses: { 200: { description: "Full calendar-year archived activity, independent of list pagination.", content: { "application/json": { schema: QueryActivitySchema } } }, 400: failure, 503: failure } }), async c => {
    const input = c.req.valid("query"), db = c.env.APP_DB!;
    const asOf = input.to ?? new Date(Date.now() + 8 * 3600_000 - 86400_000).toISOString().slice(0, 10);
    const all = scope({ ...input, to: asOf });
    const years = (await db.prepare(`SELECT DISTINCT CAST(strftime('%Y', q.occurred_at, '+8 hours') AS INTEGER) AS year FROM ${joins} WHERE ${all.where} ORDER BY year DESC`).bind(...all.values).all<{ year: number }>()).results.map(row => row.year);
    const year = input.year ?? years[0] ?? Number(asOf.slice(0, 4));
    const filter = scope({ ...input, from: `${year}-01-01`, to: asOf < `${year}-12-31` ? asOf : `${year}-12-31` });
    const cte = `WITH selected AS (SELECT q.* FROM ${joins} WHERE ${filter.where})`;
    const result = await db.batch<Row>([
      db.prepare(`${cte}, daily AS (SELECT date(occurred_at, '+8 hours') AS date, COUNT(*) AS messages, SUM(kind = 'reply') AS replies FROM selected GROUP BY date), pictures AS (SELECT date(q.occurred_at, '+8 hours') AS date, COUNT(DISTINCT link.image_id) AS images FROM selected q JOIN query_message_images link ON link.message_id = q.id GROUP BY date) SELECT daily.*, COALESCE(pictures.images, 0) AS images FROM daily LEFT JOIN pictures ON pictures.date = daily.date ORDER BY daily.date`).bind(...filter.values),
      db.prepare(`${cte} SELECT COUNT(DISTINCT q.id) AS messages, COUNT(DISTINCT link.image_id) AS images, COUNT(DISTINCT CASE WHEN q.kind = 'reply' THEN q.id END) AS replies FROM selected q LEFT JOIN query_message_images link ON link.message_id = q.id`).bind(...filter.values),
    ]);
    const days = result[0]!.results.map(row => ({ date: String(row.date), messages: Number(row.messages), images: Number(row.images), replies: Number(row.replies) }));
    const row = result[1]!.results[0];
    return c.json({ ok: true as const, data: { year, years: [...new Set([year, ...years])].toSorted((a, b) => b - a), asOf, days, totals: { messages: Number(row?.messages ?? 0), images: Number(row?.images ?? 0), replies: Number(row?.replies ?? 0), activeDays: days.length } } }, 200);
  });
}
