import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { ErrorSchema, MeleePageSchema, MeleeProgressSchema, MeleeSnapshotSchema, QueryMeleeSchema } from "@starter/shared/schemas";
import type { MeleeProgress } from "@starter/shared";
import type { AppEnv } from "../env";

const failure = { description: "Unavailable or invalid ranking request.", content: { "application/json": { schema: ErrorSchema } } };
const periodParam = z.object({ periodId: z.coerce.number().int().positive() });
const progress = (row: Record<string, unknown>): MeleeProgress => ({ snapshotId: String(row.id), periodId: Number(row.period_id), periodLabel: String(row.period_label), observedAt: String(row.observed_at), updatedAt: String(row.updated_at), nextCursor: row.next_cursor as string | null, complete: Boolean(row.complete), limited: Boolean(row.limited) });

export function registerMeleeQuery(app: OpenAPIHono<AppEnv>) {
  app.openapi(createRoute({ method: "get", path: "/melee", request: { query: z.object({ periodId: z.coerce.number().int().positive().optional() }) }, responses: { 200: { description: "Saved official weekly melee ranking. Complete snapshots are preferred over in-progress refreshes.", content: { "application/json": { schema: QueryMeleeSchema } } }, 400: failure, 503: failure } }), async c => {
    const db = c.env.APP_DB!;
    const { periodId } = c.req.valid("query");
    const periods = (await db.prepare(`SELECT period_id AS id, period_label AS label FROM query_melee_snapshots s
      WHERE s.id = (SELECT latest.id FROM query_melee_snapshots latest WHERE latest.period_id = s.period_id ORDER BY latest.observed_at DESC, latest.id DESC LIMIT 1)
      ORDER BY period_id DESC LIMIT 100`).all<{ id: number; label: string }>()).results;
    const selected = periodId ?? periods[0]?.id;
    const row = selected ? await db.prepare("SELECT * FROM query_melee_snapshots WHERE period_id = ? ORDER BY complete DESC, limited ASC, observed_at DESC, id DESC LIMIT 1").bind(selected).first<Record<string, unknown>>() : null;
    const entries = row ? (await db.prepare(`SELECT e.*, m.id AS known_member FROM query_melee_entries e LEFT JOIN query_members m ON m.id = e.member_id
      WHERE e.snapshot_id = ? ORDER BY e.rank, e.score DESC, e.member_id`).bind(row.id).all<Record<string, unknown>>()).results.map(entry => ({ memberId: String(entry.member_id), name: String(entry.name), rank: Number(entry.rank), score: Number(entry.score), memberAvailable: entry.known_member != null })) : [];
    return c.json({ ok: true as const, data: { periods, snapshot: row ? MeleeSnapshotSchema.parse(progress(row)) : null, entries } }, 200);
  });
}

export function registerMeleeIngest(app: OpenAPIHono<AppEnv>) {
  app.openapi(createRoute({ method: "get", path: "/melee/{periodId}", request: { params: periodParam }, responses: { 200: { description: "Private resumable weekly ranking progress.", content: { "application/json": { schema: z.object({ ok: z.literal(true), data: MeleeProgressSchema.nullable() }) } } }, 400: failure, 401: failure, 503: failure } }), async c => {
    const row = await c.env.APP_DB!.prepare("SELECT * FROM query_melee_snapshots WHERE period_id = ? ORDER BY observed_at DESC, id DESC LIMIT 1").bind(c.req.valid("param").periodId).first<Record<string, unknown>>();
    return c.json({ ok: true as const, data: row ? progress(row) : null }, 200);
  });
  app.openapi(createRoute({ method: "post", path: "/melee", request: { body: { required: true, content: { "application/json": { schema: MeleePageSchema } } } }, responses: { 200: { description: "Ranking entries and next cursor saved atomically.", content: { "application/json": { schema: z.object({ ok: z.literal(true), data: MeleeProgressSchema }) } } }, 400: failure, 401: failure, 409: failure, 503: failure } }), async c => {
    const db = c.env.APP_DB!;
    const input = c.req.valid("json");
    const observedAt = new Date(input.observedAt).toISOString();
    if (Date.parse(observedAt) > Date.now() + 300_000) return c.json({ ok: false as const, error: { code: "invalid_snapshot", message: "Ranking observation cannot be in the future." } }, 400);
    const existing = await db.prepare("SELECT id FROM query_melee_snapshots WHERE id = ?").bind(input.snapshotId).first();
    if (!existing && input.cursor !== null) return c.json({ ok: false as const, error: { code: "invalid_cursor", message: "A new ranking snapshot must start at the first page." } }, 400);
    const now = new Date().toISOString();
    const guard = "id = ? AND period_id = ? AND period_label = ? AND observed_at = ? AND next_cursor IS ? AND complete = 0";
    const values = [input.snapshotId, input.periodId, input.periodLabel, observedAt, input.cursor];
    const statements = [db.prepare("INSERT INTO query_melee_snapshots (id, period_id, period_label, observed_at, updated_at, next_cursor, complete) VALUES (?, ?, ?, ?, ?, NULL, 0) ON CONFLICT(id) DO NOTHING").bind(input.snapshotId, input.periodId, input.periodLabel, observedAt, now)];
    for (const entry of input.entries) statements.push(db.prepare(`INSERT INTO query_melee_entries (snapshot_id, member_id, name, rank, score)
      SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM query_melee_snapshots WHERE ${guard})
      ON CONFLICT(snapshot_id, member_id) DO UPDATE SET name = excluded.name, rank = excluded.rank, score = excluded.score`)
      .bind(input.snapshotId, entry.memberId, entry.name, entry.rank, entry.score, ...values));
    statements.push(db.prepare(`UPDATE query_melee_snapshots SET next_cursor = ?, complete = ?, limited = ?, updated_at = ? WHERE ${guard}`)
      .bind(input.nextCursor, input.nextCursor === null ? 1 : 0, input.limited ? 1 : 0, now, ...values));
    const result = await db.batch(statements);
    if (!result.at(-1)?.meta.changes) return c.json({ ok: false as const, error: { code: "stale_ranking_cursor", message: "Ranking cursor changed; reload saved progress before retrying." } }, 409);
    return c.json({ ok: true as const, data: { snapshotId: input.snapshotId, periodId: input.periodId, periodLabel: input.periodLabel, observedAt, updatedAt: now, nextCursor: input.nextCursor, complete: input.nextCursor === null, limited: input.limited } }, 200);
  });
}
