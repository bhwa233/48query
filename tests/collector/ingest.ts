import assert from "node:assert/strict";
import { HttpIngestStore } from "../../apps/collector/src/http-store";
import type { IngestUnit } from "../../apps/collector/src/types";

// A real Pocket48 page exceeded the API's 128 KiB body limit. Keep real HTTP/D1
// writes, inject a transport failure after the first chunk, and verify resume.
const endpoint = process.env.INGEST_API_URL;
const key = process.env.INGEST_KEY;
assert.ok(endpoint && key);
const store = new HttpIngestStore(endpoint, key);
const unit: IngestUnit = {
  batchId: "smoke-large-page", statDate: "2026-10-19", startedAt: new Date().toISOString(),
  member: { id: "large-page-member", name: "Large Page Member", groupName: "SNH48" },
  catalog: [{ id: "b".repeat(64), source: "album", rawJson: "{}", status: "pending" }],
  messages: [], recordings: [], messageCursor: "before-message", recordingCursor: "before-recording",
  totalMembers: 1, membersCovered: 0, errorCount: 0,
};
await store.ingestUnit(unit);
const page: IngestUnit = {
  ...unit, catalog: unit.catalog?.map(entry => ({ ...entry, status: "resolved" })), membersCovered: 1, messageCursor: "after-message", recordingCursor: "before-recording",
  messages: Array.from({ length: 50 }, (_, index) => ({
    id: `large-message-${index}`, memberId: unit.member.id, occurredAt: "2026-10-19T00:00:00.000Z",
    type: "TEXT", text: "分片记录".repeat(250), sourceJson: JSON.stringify({ detail: "x".repeat(1000) }),
  })),
};
const originalFetch = globalThis.fetch;
let writes = 0;
globalThis.fetch = async (url, options) => {
  if (String(url).endsWith("/ingest/unit") && ++writes >= 2 && writes <= 4) {
    if (writes === 2) return new Response("Error: Network connection lost.", { status: 503 });
    return Response.json({ ok: false, error: { code: "synthetic_outage", message: "interrupted chunk" } }, { status: 503 });
  }
  return originalFetch(url, options);
};
try {
  await assert.rejects(store.ingestUnit(page), /synthetic_outage/);
} finally {
  globalThis.fetch = originalFetch;
}
let state = await store.getSyncState(unit.member.id);
assert.equal((await store.pendingCatalog(unit.member.id, "album", 50)).length, 1, "A failed original write must not resolve its queue entry");
assert.equal(state.messageCursor, unit.messageCursor);
assert.equal(state.recordingCursor, unit.recordingCursor);
await store.ingestUnit(page);
state = await store.getSyncState(unit.member.id);
assert.equal((await store.pendingCatalog(unit.member.id, "album", 50)).length, 0);
assert.equal(state.messageCursor, page.messageCursor);
assert.equal(state.recordingCursor, page.recordingCursor);
const result = await originalFetch(`${endpoint}/api/query/messages?q=${encodeURIComponent("分片记录")}&limit=50`);
const payload = await result.json() as { data: { id: string }[] };
assert.deepEqual(payload.data.map(item => item.id).sort(), page.messages.map(item => item.id).sort());
console.log("PASS large UTF-8 page: bounded requests, unchanged cursors after failure, idempotent retry");

// Real local D1 must paginate pending rows by stable ID even while failed
// uploads update their retry order. Both media kinds use the same cursor rule.
for (const kind of ["image", "video"] as const) {
  const ids = ["queue-a", "queue-b", "queue-c"];
  const save = kind === "image" ? store.saveImage.bind(store) : store.saveVideo.bind(store);
  const read = kind === "image" ? store.pendingImages.bind(store) : store.pendingVideos.bind(store);
  for (const id of ids) await save({ id, sourceUrl: `https://source.48.cn/${id}`, status: "pending" });
  const first = await read(1, "queue-");
  assert.equal(first[0]?.id, ids[0]);
  await save({ ...first[0]!, status: "failed" });
  assert.deepEqual((await read(2, first[0]!.id)).map(item => item.id), ids.slice(1));
  assert.deepEqual((await read(1, ids.at(-1))).filter(item => ids.includes(item.id)), []);
}
const catalogOnly = Array.from({ length: 51 }, (_, i) => ({ id: i.toString(16).padStart(64, "0"), source: "album" as const, rawJson: "{}", status: "pending" as const }));
await store.ingestUnit({ ...unit, messages: [], catalog: catalogOnly });
assert.equal((await store.pendingCatalog(unit.member.id, "album", 50)).length, 50, "Catalog-only pages must respect the per-request row limit as well as bytes");
console.log("PASS stable media retry pagination and catalog-only request partitioning");
