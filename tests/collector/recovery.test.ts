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
import { groupWork, type GroupEntry } from "../../apps/collector/src/group-progress";

const member = { id: "1", name: "Owner", groupName: "SNH48" };
const checkpoint = (source: SourceSync["source"] = "posts"): SourceSync => ({ source, historyCursor: "older", historyDone: false,
  latestAt: "2026-10-22T00:00:00.000Z", latestIds: ["latest"], incrementalCursor: null, pendingLatestAt: null, pendingLatestIds: [],
  status: "ok", lastError: null, lastSuccessAt: null, lastNonemptyAt: null });

// Run 39903245375 left a due album isolated behind the normal member queue,
// spent none of its recovery allowance, and failed on that untouched old state.
test("due isolated sources get a separate bounded queue without polling paused or disabled sources", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-23T00:00:00Z") });
  const candidate = { name: "Owner", officialIds: [], officialPocketIds: [], candidateIds: [], groups: [], teams: [], officialStatuses: [] };
  const isolated: SourceSync = { ...checkpoint(), healthVersion: 1, failureCount: 3, failureKind: "protocol",
    skippedAt: "2026-10-22T00:00:00Z", nextRetryAt: "2026-10-22T02:00:00Z" };
  const entries: GroupEntry[] = [
    { candidate, member, identity: "verified", scopeComplete: false, sources: [checkpoint()] },
    { candidate, member: { ...member, id: "due" }, identity: "verified", scopeComplete: false,
      lastIncrementalAt: "2026-10-22T23:00:00Z", sources: [isolated, checkpoint("room")] },
    { candidate, member, identity: "verified", sources: [{ ...isolated, paused: true }] },
    { candidate, member, identity: "verified", sources: [{ ...isolated, nextRetryAt: "2026-10-24T00:00:00Z" }] },
    { candidate, member, identity: "verified", sources: [{ ...isolated, source: "album" }] },
  ];
  const work = groupWork(entries, { collect: true, refresh: true, retryUnverified: false, phase: "recovery", sources: ["posts", "room"] });
  assert.deepEqual(work.map(item => item.entry.member?.id), ["due"]);
  let saved = entries[1]!.sources!;
  const reads: string[] = [];
  const result = await runBatch({ sources: ["posts", "room"], listMembers: async () => [member], listMessages: async () => { throw new Error("room must not be polled"); },
    listContent: async (_member, source) => { reads.push(source); return { items: [], nextCursor: null }; } }, new DryRunStore(), {
    recoveryOnly: true, maxHistoryPagesPerMember: 0,
    checkpoints: { read: () => saved, write: async (_id, sync) => { saved = saved.map(item => item.source === sync.source ? sync : item); } },
  });
  assert.equal(result.errorCount, 0);
  assert.deepEqual(reads, ["posts"]);
  assert.equal(saved[0]?.failureCount, 0);
  assert.equal(saved[0]?.historyCursor, "older");
  saved = [isolated];
  const pending = await runBatch({ sources: ["posts"], listMembers: async () => [member], listMessages: async () => {
    throw new SourceVerificationPending("Historical authorship remains unverified");
  } }, new DryRunStore(), { recoveryOnly: true, maxHistoryPagesPerMember: 0,
    checkpoints: { read: () => saved, write: async (_id, sync) => { saved = [sync]; } } });
  assert.equal(pending.errorCount, 0, "A confirmed verification gap must replace the obsolete protocol fault");
  assert.equal(saved[0]?.skippedAt, null);
  assert.ok(saved[0]?.historyError);
  assert.equal(saved[0]?.lastIncrementalSuccessAt, undefined, "A gap is not a successful incremental read");
});

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

// Run 40253364027 treated never-verified rooms as stale incremental sources
// after 48 hours, failing batches and putting them ahead of established feeds.
test("unverified sources stay pending after 48 hours without outranking stale established feeds", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-23T00:00:00Z") });
  let saved = checkpoint();
  let unavailable = true;
  const source = { sources: ["posts"] as const, listMembers: async () => [member], listMessages: async () => {
    if (unavailable) throw new SourceVerificationPending("No attributable member content; verification required.");
    return { items: [], nextCursor: null };
  } };
  const run = () => runBatch(source, new DryRunStore(), { maxHistoryPagesPerMember: 0,
    checkpoints: { read: () => [saved], write: async (_id, sync) => { saved = structuredClone(sync); } } });
  await run();
  t.mock.timers.tick(72 * 3600_000);
  assert.equal((await run()).errorCount, 0, "An unresolved identity/access gap is not a failed incremental refresh");
  assert.equal(saved.lastIncrementalSuccessAt, undefined);
  const health = collectorHealth([{ memberId: member.id, sources: [saved] }]);
  assert.equal(health.failures, 0);
  assert.equal(health.sources[0]?.freshness, "unverified");
  const candidate = { name: "Owner", officialIds: [], officialPocketIds: [], candidateIds: [], groups: [], teams: [], officialStatuses: [] };
  const entries: GroupEntry[] = [
    { candidate, member, identity: "verified", scopeComplete: false, sources: [saved] },
    { candidate, member: { ...member, id: "established" }, identity: "verified", scopeComplete: false,
      lastIncrementalAt: "2026-10-23T01:00:00Z", sources: [{ ...checkpoint(), lastIncrementalSuccessAt: "2026-10-23T01:00:00Z" }] },
  ];
  assert.equal(groupWork(entries, { collect: true, refresh: true, retryUnverified: false, phase: "incremental" })[0]?.entry.member?.id, "established");
  unavailable = false;
  assert.equal((await run()).errorCount, 0);
  assert.equal(saved.lastIncrementalSuccessAt, new Date().toISOString(), "A verified empty head establishes freshness without claiming the history is complete");
  t.mock.timers.tick(48 * 3600_000);
  assert.equal(collectorHealth([{ memberId: member.id, sources: [saved] }]).failures, 1, "Once verified, an overdue head must still fail despite the retained history gap");
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

// Empty archives must not create an hourly scan loop, or hide an unfinished or
// inaccessible source. Exercise the real batch/checkpoint transitions over time.
test("confirmed empty members wait thirty days, then content restores normal collection", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-23T00:00:00Z") });
  let saved: SourceSync[] = [checkpoint("room"), checkpoint("posts")];
  let reads = 0;
  let found = false;
  class ArchiveStore extends DryRunStore {
    archived = 1;
    async contentTotals() { return { messages: this.archived, images: 0 }; }
  }
  const store = new ArchiveStore();
  const source = { sources: ["room", "posts"] as const, listMembers: async () => [member], listMessages: async () => ({ items: [], nextCursor: null }),
    listContent: async (_member: typeof member, stream: SourceSync["source"]) => {
      reads++;
      return { items: found && stream === "room" ? [{ id: "new-text", memberId: member.id, senderId: member.id, type: "TEXT", text: "new content", occurredAt: new Date().toISOString() }] : [], nextCursor: null };
    } };
  const run = () => runBatch(source, store, { since: collectionSince(),
    checkpoints: { read: () => saved, write: async (_id, sync) => { saved = saved.map(old => old.source === sync.source ? structuredClone(sync) : old); } } });
  await run();
  assert.ok(saved.every(sync => !sync.emptyCheckedAt), "Database content prevents false emptiness after legacy checkpoint loss");
  store.archived = 0;
  assert.equal((await run()).scopeComplete, true);
  assert.ok(saved.every(sync => sync.emptyCheckedAt));
  const candidate = { name: "Owner", officialIds: [], officialPocketIds: [], candidateIds: [], groups: [], teams: [], officialStatuses: [] };
  const entry = (): GroupEntry => ({ candidate, member, identity: "verified", scopeComplete: true, collectedAt: new Date().toISOString(), sources: saved });
  const work = (entries = [entry()]) => groupWork(entries, { collect: true, refresh: true, retryUnverified: false, phase: "incremental", sources: source.sources });
  const before = reads;
  t.mock.timers.tick(29 * 86400_000);
  assert.deepEqual(work(), []);
  assert.equal(collectorHealth([{ memberId: member.id, sources: saved }]).failures, 0, "Planned monthly checks are not stale active sources");
  await run();
  assert.equal(reads, before);
  for (const patch of [{ historyDone: false }, { historyError: "permission unresolved" }, { lastError: "request failed" }, { paused: true }, { emptyCheckedAt: null }]) {
    const incomplete = { ...entry(), scopeComplete: false, sources: saved.map((sync, index) => index === 0 ? { ...sync, ...patch } : sync) };
    assert.equal(work([incomplete]).length, 1);
  }
  const extended = groupWork([entry()], { collect: true, refresh: true, retryUnverified: false, phase: "incremental", sources: ["room", "posts", "album"] });
  assert.equal(extended.length, 1, "Newly enabled sources require verification");
  t.mock.timers.tick(86400_000);
  assert.equal(work().length, 1);
  found = true;
  await run();
  assert.ok(reads > before);
  assert.ok(saved.every(sync => !sync.emptyCheckedAt));
  assert.ok(saved.find(sync => sync.source === "room")?.lastNonemptyAt);
  assert.equal(work().length, 1, "A text-only member immediately rejoins hourly collection");
});
