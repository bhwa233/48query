import assert from "node:assert/strict";
import { test } from "node:test";
import { runBatch } from "../../apps/collector/src/run";
import { DryRunStore } from "../../apps/collector/src/dry-run-store";
import { SourceRequestSkipped, SourceVerificationPending, type SourceSync } from "../../apps/collector/src/types";
import { collectionSince } from "../../apps/collector/src/collection-scope";
import { Pocket48Source } from "../../apps/collector/src/pocket48-source";
import { collectorHealth } from "../../apps/collector/src/collector-report";
import { retryMedia } from "../../apps/collector/src/media-retry";
import type { MediaRetryProgress, VideoAttachment } from "../../packages/shared";

const member = { id: "1", name: "Owner", groupName: "SNH48" };
const checkpoint = (source: SourceSync["source"] = "posts"): SourceSync => ({ source, historyCursor: "older", historyDone: false,
  latestAt: "2026-10-22T00:00:00.000Z", latestIds: ["latest"], incrementalCursor: null, pendingLatestAt: null, pendingLatestIds: [],
  status: "ok", lastError: null, lastSuccessAt: null, lastNonemptyAt: null });

// Scheduled runs previously either ignored every 502 forever or suspended a
// source permanently on its third failure. Neither behavior implements recovery.
test("transient failures count once per invocation and recover from a persisted timed isolation", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-23T00:00:00Z") });
  let saved = checkpoint();
  let broken = true;
  let reads = 0;
  const source = { sources: ["posts"] as const, listMembers: async () => [member], listMessages: async () => {
    reads++;
    if (broken) throw new SourceRequestSkipped("Upstream unavailable");
    return { items: [], nextCursor: null };
  } };
  const run = (runId: string, extra = {}) => runBatch(source, new DryRunStore(), { since: collectionSince(), runId,
    maxHistoryPagesPerMember: 0, checkpoints: { read: () => [saved], write: async (_id, sync) => { saved = structuredClone(sync); } }, ...extra });
  assert.equal((await run("run-1")).errorCount, 0);
  await run("run-1");
  assert.equal(saved.failureCount, 1, "Incremental/history attempts in one invocation must not count twice");
  assert.equal((await run("run-2")).errorCount, 0);
  assert.equal((await run("run-3")).errorCount, 1, "The third actual failed invocation must remain red");
  assert.equal(saved.historyCursor, "older");
  assert.equal(saved.historyDone, false);
  const before = reads;
  assert.equal((await run("run-4")).errorCount, 1, "Isolation must not hide an unresolved persistent failure");
  assert.equal(reads, before);
  t.mock.timers.tick(2 * 3600_000);
  await run("quota-exhausted", { recovery: { remaining: 0, spentMs: 0, maxMs: 180_000 } });
  assert.equal(reads, before, "Exhausting recovery quota must not start another upstream read");
  await run("probe-1");
  assert.equal(reads, before + 1);
  assert.equal(Date.parse(saved.nextRetryAt!) - Date.now(), 6 * 3600_000);
  t.mock.timers.tick(6 * 3600_000);
  for (const [id, waitHours] of [["probe-2", 12], ["probe-3", 24], ["probe-4", 24]] as const) {
    assert.equal((await run(id)).errorCount, 1);
    assert.equal(Date.parse(saved.nextRetryAt!) - Date.now(), waitHours * 3600_000);
    t.mock.timers.tick(waitHours * 3600_000);
  }
  broken = false;
  assert.equal((await run("probe-recovered")).errorCount, 0);
  assert.equal(saved.failureCount, 0);
  assert.equal(saved.nextRetryAt, null);
  assert.equal(saved.lastIncrementalSuccessAt, new Date().toISOString(), "Verified empty responses refresh source health");
  assert.equal(saved.historyCursor, "older", "An incremental recovery must not discard pending history");
});

// Read-only diagnostic run 39895325213 reproduced both production failures:
// posts omits its list at an echoed cursor; room_posts echoes an empty list.
test("confirmed empty timeline and room-post tails finish without accepting nonempty or unknown shapes", async () => {
  for (const stream of ["posts", "room_posts", "room"] as const) {
    let nonempty = false;
    const source = new Pocket48Source({ token: "synthetic", pa: "synthetic", minIntervalMs: 0, since: null,
      sources: [stream], fetchImpl: async url => String(url).endsWith("/jump")
        ? Response.json({ status: 200, content: { channelId: 22, serverId: 33 } }) : String(url).endsWith("/im/search")
        ? Response.json({ status: 200, content: { data: [] } })
        : Response.json({ status: 200, content: stream === "posts"
          ? nonempty ? { postsInfo: [{ postId: "1", userId: "1", createAt: Date.parse("2026-10-22") }], nextId: "123" } : { nextId: "123" }
          : { message: nonempty ? [{ msgidClient: "1", msgTime: Date.parse("2026-10-22"), msgType: "TEXT" }] : [], nextTime: 123 } }) });
    const page = await source.listContent(member, stream, "123");
    assert.equal(page.nextCursor, null);
    assert.deepEqual(page.items, []);
    nonempty = true;
    await assert.rejects(source.listContent(member, stream, "123"), /repeated a page cursor/);
  }
  const unknown = new Pocket48Source({ token: "synthetic", pa: "synthetic", minIntervalMs: 0,
    fetchImpl: async () => Response.json({ status: 200, content: { nextId: "456" } }) });
  await assert.rejects(unknown.listContent(member, "posts", "123"), /unknown content list shape/);
});

test("incremental freshness ages through warning and failure independently of empty history and manual pauses", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-23T00:00:00Z") });
  let saved = checkpoint();
  const source = { sources: ["posts"] as const, listMembers: async () => [member], listMessages: async () => ({ items: [], nextCursor: null }) };
  await runBatch(source, new DryRunStore(), { since: collectionSince(), maxHistoryPagesPerMember: 0,
    checkpoints: { read: () => [saved], write: async (_id, sync) => { saved = structuredClone(sync); } } });
  t.mock.timers.tick(24 * 3600_000);
  assert.equal(collectorHealth([{ memberId: "1", sources: [saved] }]).warnings, 1);
  assert.equal(collectorHealth([{ memberId: "1", sources: [saved] }]).failures, 0);
  await runBatch(source, new DryRunStore(), { since: collectionSince(), historyOnly: true, maxHistoryPagesPerMember: 1,
    checkpoints: { read: () => [saved], write: async (_id, sync) => { saved = structuredClone(sync); } } });
  t.mock.timers.tick(24 * 3600_000);
  const health = collectorHealth([{ memberId: "1", sources: [saved, { ...saved, source: "room", paused: true }] }]);
  assert.equal(health.failures, 1, "A history read must not refresh the incremental deadline");
  assert.equal(health.paused, 1);
});

// A single source video timeout previously failed the entire media job on the
// first run. Queue health must persist across runners and observe the same rule.
test("media timeouts degrade twice then remain failed until a scheduled probe succeeds", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-23T00:00:00Z") });
  let saved: MediaRetryProgress | null = null;
  let broken = true;
  let uploads = 0;
  const video: VideoAttachment = { id: "video", sourceUrl: "https://source.48.cn/video.mp4", status: "pending" };
  const store = Object.assign(new DryRunStore(), {
    mediaProgress: async () => structuredClone(saved),
    saveMediaProgress: async (progress: MediaRetryProgress) => { saved = structuredClone(progress); },
    pendingVideos: async () => [structuredClone(video)], saveVideo: async () => {},
  });
  const run = (runId: string) => retryMedia(store, { since: collectionSince(), runId, mediaOnly: true, maxBatches: 1,
    archiveVideo: async () => { uploads++; if (broken) throw new Error("Source timeout"); } });
  assert.equal((await run("one")).persistentFailures, 0);
  assert.equal((await run("two")).persistentFailures, 0);
  assert.equal((await run("three")).persistentFailures, 1);
  const before = uploads;
  assert.equal((await run("four")).persistentFailures, 1);
  assert.equal(uploads, before, "Isolation must retain the failed item without uploading early");
  broken = false;
  t.mock.timers.tick(2 * 3600_000);
  assert.equal((await run("probe")).persistentFailures, 0);
  assert.equal(uploads, before + 1);
});

// The old three-strike guard froze new room messages when only historical
// author evidence was unavailable. Retain the historical gap and poll the head.
test("historical verification gaps do not suspend incremental reads or certify full history", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-23T00:00:00Z") });
  let saved: SourceSync = { ...checkpoint("room"), status: "failed", failureCount: 3,
    skippedAt: "2026-10-22T00:00:00.000Z", lastError: "No attributable member room messages observed yet; collection is not verified." };
  let heads = 0;
  const source = { sources: ["room"] as const, listMembers: async () => [member], listMessages: async (_member: typeof member, cursor: string | null) => {
    if (cursor === "older") throw new SourceVerificationPending("Historical authorship remains unverified");
    heads++;
    return { items: [], nextCursor: null };
  } };
  const run = (runId: string, historyOnly = false) => runBatch(source, new DryRunStore(), { since: collectionSince(), runId,
    historyOnly, maxHistoryPagesPerMember: 1,
    checkpoints: { read: () => [saved], write: async (_id, sync) => { saved = structuredClone(sync); } } });
  for (let i = 0; i < 4; i++) {
    assert.equal((await run(`run-${i}`)).errorCount, 0);
    t.mock.timers.tick(3600_000);
  }
  assert.equal(heads, 4);
  assert.equal(saved.historyDone, false);
  assert.equal(saved.historyCursor, "older");
  assert.ok(saved.historyError);
  const fresh = saved.lastIncrementalSuccessAt;
  await run("history", true);
  assert.equal(saved.lastIncrementalSuccessAt, fresh, "History work must not conceal a stale incremental source");
});
