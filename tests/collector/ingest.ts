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
  messages: [], recordings: [], messageCursor: "before-message", recordingCursor: "before-recording",
  totalMembers: 1, membersCovered: 0, errorCount: 0,
};
await store.ingestUnit(unit);
const page: IngestUnit = {
  ...unit, membersCovered: 1, messageCursor: "after-message", recordingCursor: "before-recording",
  messages: Array.from({ length: 50 }, (_, index) => ({
    id: `large-message-${index}`, memberId: unit.member.id, occurredAt: "2026-10-19T00:00:00.000Z",
    type: "TEXT", text: "分片记录".repeat(250), sourceJson: JSON.stringify({ detail: "x".repeat(1000) }),
  })),
};
const originalFetch = globalThis.fetch;
let writes = 0;
globalThis.fetch = async (url, options) => {
  if (String(url).endsWith("/ingest/unit") && ++writes === 2) {
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
assert.equal(state.messageCursor, unit.messageCursor);
assert.equal(state.recordingCursor, unit.recordingCursor);
await store.ingestUnit(page);
state = await store.getSyncState(unit.member.id);
assert.equal(state.messageCursor, page.messageCursor);
assert.equal(state.recordingCursor, page.recordingCursor);
const result = await originalFetch(`${endpoint}/api/query/messages?q=${encodeURIComponent("分片记录")}&limit=50`);
const payload = await result.json() as { data: { id: string }[] };
assert.deepEqual(payload.data.map(item => item.id).sort(), page.messages.map(item => item.id).sort());
console.log("PASS large UTF-8 page: bounded requests, unchanged cursors after failure, idempotent retry");
