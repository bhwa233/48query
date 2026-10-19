import assert from "node:assert/strict";
import { DemoSource } from "../../apps/collector/src/demo-source";
import { HttpIngestStore } from "../../apps/collector/src/http-store";
import { runBatch } from "../../apps/collector/src/run";

// Production failed before its first ingest unit, so no batch row existed and
// completion's 404 masked the original Pocket48 error. Use the real HTTP store
// against the smoke runner's migrated local D1; only the upstream failure is fake.
class FailingSource extends DemoSource {
  override async listMessages(): ReturnType<DemoSource["listMessages"]> {
    throw new Error("synthetic channel unavailable");
  }
}

const endpoint = process.env.INGEST_API_URL;
const key = process.env.INGEST_KEY;
assert.ok(endpoint && key);
const result = await runBatch(new FailingSource(), new HttpIngestStore(endpoint, key), {
  batchId: "smoke-first-member-failed",
  maxMembers: 1,
  maxPagesPerMember: 1,
});
assert.equal(result.membersCovered, 0);
assert.equal(result.errorCount, 1);
console.log("PASS first-member failure: batch completed without masking upstream error");
