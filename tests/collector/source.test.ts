import assert from "node:assert/strict";
import { test } from "node:test";
import { contentList, normalizeMessage, parsePocketJson } from "../../apps/collector/src/pocket48-content";
import { runBatch } from "../../apps/collector/src/run";
import { DryRunStore } from "../../apps/collector/src/dry-run-store";
import { DemoSource } from "../../apps/collector/src/demo-source";
import type { IngestUnit } from "../../apps/collector/src/types";
import { Pocket48Source } from "../../apps/collector/src/pocket48-source";
import { GalleryUploader } from "../../apps/collector/src/gallery";
import { retryMedia } from "../../apps/collector/src/media-retry";
import { buildGroupRoster, directoryEntries, HISTORICAL_DIRECTORY_URL, readHistoricalDirectory } from "../../apps/collector/src/group-roster";
import { applyGroupScope, groupWork, reconcileGroupEntries, type GroupEntry, type GroupProgress } from "../../apps/collector/src/group-progress";
import { collectionSince } from "../../apps/collector/src/collection-scope";
import { HttpIngestStore } from "../../apps/collector/src/http-store";
import { CollectionBudget } from "../../apps/collector/src/budget";
import type { SourceSync } from "../../apps/collector/src/types";
import type { ImageAttachment, VideoAttachment } from "../../packages/shared";

// The previous job only stopped between members. A page committed just before
// the budget expires must survive, without failure or a false completion flag.
test("budget stops between committed pages and the next batch resumes its cursor", async () => {
  const budget = new CollectionBudget();
  let saved: SourceSync[] = [];
  const scope = { read: () => saved, write: async (_id: string, sync: SourceSync) => { saved = [sync]; budget.stop(); } };
  const store = new DryRunStore();
  const member = { id: "1", name: "Owner", groupName: "SNH48" };
  const reads: (string | null)[] = [];
  const source = { sources: ["posts"] as const, listMembers: async () => [member], listMessages: async (_member: typeof member, cursor: string | null) => {
    reads.push(cursor);
    return { items: [{ id: cursor ?? "new", memberId: member.id, type: "POST", occurredAt: cursor ? "2026-01-01T00:00:00.000Z" : "2026-10-01T00:00:00.000Z" }], nextCursor: cursor ? null : "older" };
  } };
  const first = await runBatch(source, store, { since: collectionSince(), checkpoints: scope, budget, maxHistoryPagesPerMember: 20 });
  assert.deepEqual(reads, [null]);
  assert.equal(first.budgetReached, true);
  assert.equal(first.errorCount, 0);
  assert.equal(first.scopeComplete, false);
  assert.equal(saved[0]?.historyCursor, "older");
  const second = await runBatch(source, store, { since: collectionSince(), checkpoints: scope, budget: new CollectionBudget(), historyOnly: true, maxHistoryPagesPerMember: 1 });
  assert.deepEqual(reads, [null, "older"]);
  assert.equal(second.scopeComplete, true);
});

test("a budget ending during a media upload leaves that item retryable", async () => {
  const budget = new CollectionBudget();
  const image: ImageAttachment = { id: "pending", sourceUrl: "https://source.48.cn/pending.jpg", status: "pending" };
  const saved: string[] = [];
  const result = await retryMedia({ ...new DryRunStore(), getSyncState: async () => null, ingestUnit: async () => {}, completeBatch: async () => {},
    pendingImages: async () => [image], saveImage: async item => { saved.push(item.id); } }, {
    budget, mediaOnly: true, archiveImage: async () => { budget.stop(); throw new Error("Interrupted upload"); },
  });
  assert.equal(result.budgetReached, true);
  assert.equal(result.failures, 0);
  assert.equal(image.status, "pending");
  assert.deepEqual(saved, []);
});

// GitHub-hosted collection failed before its first member because the public
// historical directory rejects runner IPs with 403. A dated candidate snapshot
// is a fallback only for that known source; custom directories still fail.
test("historical directory survives upstream runner blocking without replacing a custom source", async () => {
  const blocked: typeof fetch = async () => new Response(null, { status: 403 });
  const snapshot = await readHistoricalDirectory({ fetchImpl: blocked });
  assert.ok(directoryEntries(snapshot).some(value => String((value as { id?: unknown }).id) === "9"), "The fallback must retain retired candidates absent from the smaller directory");
  await assert.rejects(readHistoricalDirectory({ url: "https://synthetic.invalid/members.json", fetchImpl: blocked }), /HTTP 403/);
  const live = { roomId: [{ id: "fresh", ownerName: "New candidate" }] };
  assert.deepEqual(await readHistoricalDirectory({ url: HISTORICAL_DIRECTORY_URL, fetchImpl: async () => Response.json(live) }), live, "A live source must take precedence over the snapshot");
});

// Previously a pre-2026 album triggered deep original lookups and a historical
// completion flag could make a fresh, date-limited run skip the requested year.
test("date-scoped collection keeps the Beijing New Year boundary and resumes only its own checkpoints", async () => {
  const since = collectionSince("2026-01-01T00:00:00+08:00");
  const member = { id: "1", name: "Owner", groupName: "SNH48" };
  const entry: GroupEntry = { candidate: { name: "Owner", officialIds: [], officialPocketIds: [], candidateIds: ["1"], groups: [], teams: [], officialStatuses: [] }, member, identity: "verified", collectedAt: "2026-10-01T00:00:00Z", scopeComplete: true };
  const progress: GroupProgress = { version: 1, createdAt: "", updatedAt: "", officialRows: 1, excluded: [], entries: [entry] };
  applyGroupScope(progress, since);
  assert.equal(entry.identity, "verified");
  assert.equal(entry.collectedAt, undefined, "Unbounded attempts cannot certify 2026 coverage");
  let checkpoints: SourceSync[] = [];
  const scope = { read: () => checkpoints, write: async (_id: string, sync: SourceSync) => { checkpoints = [sync]; } };
  const store = new DryRunStore();
  const read: (string | null)[] = [];
  const source = { sources: ["posts" as const], listMembers: async () => [member], listMessages: async (_member: typeof member, cursor: string | null) => {
    read.push(cursor);
    return { items: cursor === null ? [{ id: "new", memberId: "1", type: "POST", occurredAt: "2026-10-01T00:00:00.000Z" }]
      : [{ id: "inclusive", memberId: "1", type: "POST", occurredAt: "2025-12-31T16:00:00.000Z" }, { id: "old", memberId: "1", type: "POST", occurredAt: "2025-12-31T15:59:59.999Z" }], nextCursor: cursor === null ? "second" : "must-not-read" };
  } };
  const first = await runBatch(source, store, { since, checkpoints: scope, maxPagesPerMember: 1, maxHistoryPagesPerMember: 0 });
  assert.equal(first.scopeComplete, false, "One finite page must remain unverified");
  assert.equal(checkpoints[0]?.historyCursor, "second");
  const second = await runBatch(source, store, { since, checkpoints: scope, historyOnly: true, maxPagesPerMember: 1, maxHistoryPagesPerMember: 1 });
  assert.deepEqual(read, [null, "second"]);
  assert.equal(second.scopeComplete, true);
  assert.ok(store.units.some(unit => unit.messages.some(message => message.id === "inclusive")));
  assert.ok(!store.units.some(unit => unit.messages.some(message => message.id === "old")));
  assert.ok(store.units.every(unit => !unit.sync), "Scoped completion must not overwrite all-history D1 checkpoints");
});

test("pre-2026 album entries stop pagination before original lookup and remain outside the private queue", async () => {
  const requests: string[] = [];
  const source = new Pocket48Source({ token: "synthetic", pa: "synthetic", minIntervalMs: 0, fetchImpl: async url => {
    const path = new URL(String(url)).pathname;
    requests.push(path);
    if (path.endsWith("/jump")) return Response.json({ status: 200, content: { channelId: 22, serverId: 33 } });
    if (path.endsWith("/msg/list/img")) return Response.json({ status: 200, content: { imgAndVideoList: [{ createTime: Date.parse("2025-12-31T15:59:59.999Z"), bodys: { url: "https://source.48.cn/old.jpg" } }], nextTime: 123 } });
    throw new Error("An older original must never be requested.");
  } });
  const page = await source.listContent({ id: "1", name: "Owner", groupName: "SNH48" }, "album", null);
  assert.equal(page.nextCursor, null);
  assert.equal(page.reachedSince, true);
  assert.deepEqual(page.items, []);
  assert.deepEqual(page.catalog, []);
  assert.equal(page.unverified, 0);
  assert.equal(requests.length, 2);
});

test("media retries require the private queue to confirm its date scope", async context => {
  const image = (id: string): ImageAttachment => ({ id, sourceUrl: `https://source.48.cn/${id}.jpg`, status: "pending" });
  context.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const query = new URL(String(url));
    assert.equal(query.pathname, "/api/query/ingest/images");
    assert.equal(query.searchParams.get("since"), collectionSince());
    return Response.json({ ok: true, data: [
      image("old"),
    ] });
  });
  const store = new HttpIngestStore("http://synthetic.invalid", "synthetic", collectionSince());
  await assert.rejects(store.pendingImages(10), /did not confirm/, "An older deployed API that ignores the date filter must not expose pre-2026 uploads");
});

// A daily member/page budget used to stop at the same first members. Rotation
// must survive failed source attempts without preventing first-time coverage.
test("bounded group runs rotate completed attempts and keep unverified identities explicit", () => {
  const candidate = { name: "Member", officialIds: ["1"], officialPocketIds: [], candidateIds: [], groups: [], teams: [], officialStatuses: [] };
  const entries: GroupEntry[] = [
    { candidate, member: null, identity: "verified", collectedAt: "2026-01-01T00:00:00Z", lastAttemptAt: "2026-04-01T00:00:00Z", errorCount: 3 },
    { candidate, member: null, identity: "verified", collectedAt: "2026-02-01T00:00:00Z", lastAttemptAt: "2026-02-01T00:00:00Z" },
    { candidate, member: null, identity: "pending" },
    { candidate, member: null, identity: "verified", lastAttemptAt: "2026-03-01T00:00:00Z" },
  ];
  const options = { collect: true, refresh: true, retryUnverified: false };
  assert.deepEqual(groupWork(entries, options).map(item => entries.indexOf(item.entry)), [2, 3, 1, 0]);
  entries[2]!.identity = "unverified";
  entries[3]!.collectedAt = entries[3]!.lastAttemptAt = "2026-05-01T00:00:00Z";
  entries[3]!.errorCount = 2;
  assert.deepEqual(groupWork(entries, options).map(item => entries.indexOf(item.entry)), [1, 0, 3], "A failed attempt still yields to older members in the next run");
  assert.deepEqual(groupWork(entries, { ...options, refresh: false }), [], "First coverage does not automatically recollect an already attempted member");
  assert.deepEqual(groupWork(entries, { collect: false, refresh: false, retryUnverified: true }).map(item => entries.indexOf(item.entry)), [2]);
  entries[0]!.lastIncrementalAt = "2026-10-19T00:00:00Z";
  entries[1]!.lastIncrementalAt = "2026-10-18T00:00:00Z";
  entries[3]!.lastIncrementalAt = "2026-10-20T00:00:00Z";
  assert.deepEqual(groupWork(entries, { ...options, phase: "incremental" }).map(item => entries.indexOf(item.entry)), [1, 0, 3], "Frequent updates rotate independently of historical completion");
});

// One directory page expands into many original-message requests. Cap that
// expansion while retaining every unresolved item for private verification.
test("bounded album lookups retain untouched directory rows instead of stalling a member", async () => {
  let originalReads = 0;
  const at = Date.parse("2026-10-01T00:00:00.000Z");
  const source = new Pocket48Source({ token: "synthetic", pa: "synthetic", minIntervalMs: 0, maxOriginalLookups: 1, fetchImpl: async url => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/jump")) return Response.json({ status: 200, content: { channelId: 22, serverId: 33 } });
    if (path.endsWith("/msg/list/img")) return Response.json({ status: 200, content: { imgAndVideoList: [0, 1, 2].map(index => ({ createTime: at - index * 1000, bodys: { url: `https://source.48.cn/${index}.jpg` } })), nextTime: 123 } });
    originalReads++;
    return Response.json({ status: 200, content: { message: [{ msgIdServer: "fan", msgTime: at, msgType: "TEXT", bodys: "fan", extInfo: { user: { userId: "999" } } }], nextTime: at } });
  } });
  const page = await source.listContent({ id: "1", name: "Owner", groupName: "SNH48" }, "album", null);
  assert.equal(originalReads, 1);
  assert.equal(page.nextCursor, "123");
  assert.equal(page.unverified, 3);
  assert.equal(page.catalog?.filter(item => item.status === "pending").length, 3);
  const lookup = JSON.parse(page.catalog![0]!.rawJson);
  assert.equal(lookup.originalCursors.all, at, "Stopping before the ordinary page cap must retain the original lookup cursor");
  assert.deepEqual(page.items, [], "Unverified directory rows must never become attributed messages");
});

test("roster refresh retains missing graduates and retries newly discovered identity mappings", () => {
  const base = { name: "Former", officialIds: ["10001"], officialPocketIds: ["11"], candidateIds: ["11"], groups: ["SNH48"], teams: [], officialStatuses: ["44"] };
  const previous: GroupEntry[] = [
    { candidate: base, member: { id: "11", name: "Former", groupName: "SNH48" }, identity: "verified", collectedAt: "2026-01-01T00:00:00Z" },
    { candidate: { ...base, name: "Missing ID", officialIds: ["10002"], officialPocketIds: [], candidateIds: [] }, member: null, identity: "unverified" },
  ];
  const roster = buildGroupRoster({ rows: [
    { sid: "10002", sname: "Missing ID", gname: "SNH", pocket_id: "12" },
    { sid: "10003", sname: "New member", gname: "SNH", pocket_id: "13" },
  ] }, { roomId: [] });
  const merged = reconcileGroupEntries(previous, roster);
  assert.equal(merged.find(entry => entry.candidate.name === "Former")?.collectedAt, previous[0]?.collectedAt, "A removed website record must not delete graduate coverage");
  assert.equal(merged.find(entry => entry.candidate.name === "Missing ID")?.identity, "pending", "New identity evidence needs a fresh official verification");
  assert.equal(merged.find(entry => entry.candidate.name === "New member")?.identity, "pending");
});

test("group roster retains transferred and missing identities without substituting website IDs", () => {
  const roster = buildGroupRoster({ rows: [
    { sid: "10001", sname: "Transferred", gname: "SNH", pocket_id: "12", tname: "HII", status: "99" },
    { sid: "30001", sname: "Transferred", gname: "GNZ", pocket_id: "12", tname: "G", status: "44" },
    { sid: "10002", sname: "Missing", gname: "SNH", pocket_id: "0", status: "44" },
  ] }, { roomId: [{ id: 12, ownerName: "GNZ48-Transferred" }, { id: 63, ownerName: "袋王" },
    { id: 13, ownerName: "Former", groupName: "SNH48" }, { id: 14, ownerName: "Project", groupName: "燃烧吧团魂" }] },
  { retired: [{ id: "27", name: "Retired only" }, { name: "No known Pocket48 ID" }, { id: "14", name: "Project", groupName: "燃烧吧团魂" }] });
  const transferred = roster.candidates.find(entry => entry.name === "Transferred")!;
  assert.deepEqual(transferred.candidateIds, ["12"]);
  assert.deepEqual(transferred.officialIds, ["10001", "30001"]);
  assert.deepEqual(transferred.groups, ["SNH48", "GNZ48"]);
  assert.deepEqual(roster.candidates.find(entry => entry.name === "Missing")?.candidateIds, [], "Website IDs must never become user IDs");
  assert.deepEqual(roster.candidates.find(entry => entry.name === "Former")?.officialIds, [], "Former directory members remain explicit supplemental candidates");
  assert.deepEqual(roster.candidates.find(entry => entry.name === "Retired only")?.candidateIds, ["27"]);
  assert.deepEqual(roster.candidates.find(entry => entry.name === "No known Pocket48 ID")?.candidateIds, [], "An unmapped retired member must remain visible without a guessed ID");
  assert.deepEqual(roster.excluded.map(entry => entry.id), ["63", "14"]);
  assert.throws(() => buildGroupRoster({ total: 10, rows: [{ sid: "10001", sname: "Member", gname: "SNH" }] }, { roomId: [] }), /truncated/);
  const collision = buildGroupRoster({ rows: [
    { sid: "10001", sname: "Same name", gname: "SNH", pocket_id: "0" },
    { sid: "30001", sname: "Same name", gname: "GNZ", pocket_id: "12" },
  ] }, { roomId: [{ id: "12", name: "Same name" }] });
  assert.equal(collision.candidates.length, 2, "A name alone must not merge distinct official profiles");
  assert.equal(collision.candidates[0]?.ambiguousName, true);
  assert.deepEqual(collision.candidates[0]?.candidateIds, []);
  const namesakes = buildGroupRoster({ rows: [
    { sid: "10001", sname: "Namesake", gname: "SNH", pocket_id: "0" },
    { sid: "30001", sname: "Namesake", gname: "GNZ", pocket_id: "0" },
  ] }, { roomId: [{ id: "12", name: "Namesake" }, { id: "13", name: "Namesake" }] });
  assert.deepEqual(namesakes.candidates.filter(entry => !entry.officialIds.length).map(entry => entry.candidateIds), [["12"], ["13"]], "Independent native identities must not be merged by name or assigned an unverified website ID");
});

test("group identity rejects same-name fans and conflicting official accounts", async () => {
  const source = new Pocket48Source({ since: null, token: "synthetic", pa: "synthetic", minIntervalMs: 0, fetchImpl: async (url, init) => {
    const { userId } = JSON.parse(String(init?.body));
    if (userId === "11") return Response.json({ status: 500, content: {} });
    if (String(url).endsWith("/im/search")) return Response.json({ status: 200, content: [{ ownerId: "12", targetType: 0 }, { ownerId: "999", targetType: 0 }] });
    if (String(url).endsWith("/star/archives")) return Response.json({ status: 200, content: { starInfo: { starGroupName: "SNH48" } } });
    return Response.json({ status: 200, content: { baseUserInfo: { userId, nickname: "Member", isStar: userId !== "999" } } });
  } });
  const candidate = { name: "Member", officialIds: ["10001"], officialPocketIds: [], candidateIds: ["11", "999", "12"], groups: ["SNH48"], teams: [], officialStatuses: ["44"] };
  assert.equal((await source.resolveGroupCandidate(candidate))?.id, "12", "A same-name fan is not a member");
  assert.equal((await source.resolveGroupCandidate({ ...candidate, candidateIds: [] }))?.id, "12", "Missing IDs must use official search plus profile verification");
  await assert.rejects(source.resolveGroupCandidate({ ...candidate, candidateIds: ["12", "13"] }), /Multiple official Pocket48 identities/);
});

// Variable signing latency must not let simultaneous callers send a burst
// after their pre-signing rate-limit slots have already elapsed.
test("spaces actual Pocket48 requests even when signing completes out of order", async context => {
  const start = Date.parse("2026-10-19T00:00:00Z");
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: start });
  let finishSigning!: (pa: string) => void;
  const slowSignature = new Promise<string>(resolve => { finishSigning = resolve; });
  let signatures = 0;
  const attempts: number[] = [];
  const source = new Pocket48Source({ since: null, token: "synthetic-token", minIntervalMs: 1200,
    paFactory: () => ++signatures === 1 ? slowSignature : "synthetic-pa",
    fetchImpl: async () => { attempts.push(Date.now()); return Response.json({ status: 200, content: { nextId: "0" } }); },
  });
  const member = { id: "1", name: "Member", groupName: "SNH48" };
  const done = Promise.all([source.listContent(member, "posts", null), source.listContent(member, "posts", null)]);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(attempts, [start]);
  context.mock.timers.tick(500);
  finishSigning("synthetic-pa");
  await new Promise<void>(resolve => setImmediate(resolve));
  context.mock.timers.tick(699);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(attempts.length, 1, "Finishing a slow signature must not bypass the request delay");
  context.mock.timers.tick(1);
  await done;
  assert.deepEqual(attempts, [start, start + 1200]);
});

// The public directory's channel IDs went stale. Production requested those
// directly and got "频道不存在" instead of resolving the member's current room.
test("resolves stale directory rooms once per member and preserves upstream failures", async () => {
  let roomLookups = 0;
  let messageRequests = 0;
  let denyLookup = false;
  let emptyEssence = false;
  const source = new Pocket48Source({ since: null,
    token: "synthetic-token",
    pa: "synthetic-pa",
    minIntervalMs: 0,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("/im/server/jump")) {
        roomLookups += 1;
        return Response.json(denyLookup
          ? { status: 401, success: false, message: "synthetic authentication failure" }
          : { status: 200, content: body.tabId === 0
            ? { channelId: 22, jumpServerInfo: { serverId: 33 } }
            : { friend: false, star: true } });
      }
      messageRequests += 1;
      if (body.channelId !== 22 || body.serverId !== 33) {
        return Response.json({ status: 500, success: false, message: "频道不存在" });
      }
      if (String(url).endsWith("/essence/message/list")) return Response.json({ status: 200, content: emptyEssence ? {} : { essenceMessageList: [{ msgIdServer: "essence-id", msgTime: 1792368000000, msgType: "TEXT", bodys: "member text", extInfo: { user: { userId: "1" } } }] } });
      return Response.json({ status: 200, content: { message: [], nextTime: body.nextTime } });
    },
  });
  const member = { id: "1", name: "Synthetic member", groupName: "SNH48", channelId: "old-channel", serverId: "old-server" };
  await source.listMessages(member, null);
  await assert.rejects(source.listMessages(member, "123"), /repeated.*cursor/);
  assert.equal(roomLookups, 1);
  assert.equal(messageRequests, 2);
  denyLookup = true;
  await assert.rejects(source.listMessages({ ...member, id: "2" }, null), /business 401/);
  assert.equal(messageRequests, 2, "Failed room lookup must not become an empty successful page");
  // Live essence responses have no nextTime. Missing cursors must not compare
  // equal to the initial null cursor and reject a valid finite list.
  const essence = await source.listContent(member, "essence", null);
  assert.equal(essence.items[0]?.text, "member text");
  assert.equal(essence.nextCursor, null);
  emptyEssence = true;
  assert.deepEqual((await source.listContent(member, "essence", null)).items, []);
});

// Han Jiale's jump and room-info endpoints no longer locate her channel, but
// the historical essence endpoint still returns her own messages. Missing
// mapping must not suppress that archive or accept an unrelated candidate.
test("recovers member-authored historical essence without treating the candidate as a current room", async () => {
  let essenceRequests = 0;
  let empty = false;
  const source = new Pocket48Source({ since: null, token: "synthetic", pa: "synthetic", minIntervalMs: 0, fetchImpl: async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/im/search")) return Response.json({ status: 200, content: [] });
    if (String(url).includes("/team/message/") || String(url).endsWith("/msg/list/img")) return Response.json({ status: 500 });
    if (String(url).endsWith("/im/server/jump")) return Response.json(body.starId === 4
      ? { status: 401 } : { status: 200, content: { friend: true, star: true } });
    essenceRequests++;
    return Response.json({ status: 200, content: empty ? {} : { essenceMessageList: [
      { msgIdServer: "historical-essence", msgTime: 1772881086647, msgType: "TEXT", bodys: "archived member text", extInfo: { user: { userId: "1" } } },
    ] } });
  } });
  const member = { id: "1", name: "Owner", groupName: "SNH48", channelId: "1345525", serverId: "951570" };
  const page = await source.listContent(member, "essence", null);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.memberId, member.id);
  await assert.rejects(source.listMessages(member, null), /anchors|business 500|history.*unverified/, "Ordinary history must independently verify original messages");
  await assert.rejects(source.listContent({ ...member, id: "2" }, "essence", null), /historical essence.*verified/i, "Another sender cannot verify a candidate channel");
  empty = true;
  await assert.rejects(source.listContent({ ...member, id: "3" }, "essence", null), /historical essence.*verified/i, "An empty candidate must not mark unavailable history complete");
  const requestsBeforeDenial = essenceRequests;
  await assert.rejects(source.listContent({ ...member, id: "4" }, "essence", null), /business 401/);
  assert.equal(essenceRequests, requestsBeforeDenial, "An authentication failure must not trigger historical fallback");
});

// Eleven followed accounts have no modern channel, but their legacy share
// feeds still return content. A missing modern room must not block these feeds,
// and a fuzzy name search must never select another member's room. Member 37
// is absent from search; that API supports an owner-only feed with roomId="".
test("reads legacy shares without a modern channel and verifies the searched room owner", async () => {
  let shareRequests = 0;
  const source = new Pocket48Source({ since: null, token: "synthetic", pa: "synthetic", minIntervalMs: 0, fetchImpl: async (url, init) => {
    const body = JSON.parse(String(init?.body));
    const content = String(url).endsWith("/im/server/jump") ? { friend: true, star: true }
      : String(url).endsWith("/im/search") ? { data: [{ ownerId: "1", targetType: 0, targetId: "verified-room" }] }
      : (() => {
        assert.equal(body.roomId, body.ownerId === "1" ? "verified-room" : "");
        shareRequests++;
        return { message: [
          { msgidClient: "share", msgTime: 1754995019661, msgType: "CUSTOM", bodys: "", extInfo: { messageType: "WEI_BO", user: { userId: "1" }, content: "verified shared text" } },
          ...(body.ownerId === "2" ? [{ msgidClient: "owner-only", msgTime: 1754995019661, msgType: "CUSTOM", bodys: "", extInfo: { user: { userId: "2" }, content: "owner-only text" } }] : []),
        ], nextTime: 0 };
      })();
    return Response.json({ status: 200, content });
  } });
  const member = { id: "1", name: "Owner", groupName: "SNH48", channelId: "stale-channel", roomId: "stale-room" };
  const page = await source.listContent(member, "weibo", null);
  assert.equal(page.items[0]?.text, "verified shared text");
  assert.equal(member.roomId, "verified-room");
  const other = await source.listContent({ id: "2", name: "Other owner", groupName: "SNH48" }, "weibo", null);
  assert.deepEqual(other.items.map(row => row.memberId), ["2"], "Owner-only lookup must still reject content with an unverified sender");
  assert.equal(other.items[0]?.roomId, null, "A member ID is not evidence of a room ID");
  assert.equal(shareRequests, 2, "Wrong-owner search results must use owner-only lookup instead of the other room");
});

// Reference formats place old TEXT content in extInfo, and use integers too
// large for IEEE-754 IDs. A room name or member role must never assign fan text.
test("preserves member authorship, large IDs, legacy text and public question/answer meaning", () => {
  const owner = { id: "1", name: "Owner", groupName: "SNH48", channelId: "10" };
  const visitor = { id: "2", name: "Visitor", groupName: "SNH48" };
  const directory = new Map([[owner.id, owner], [visitor.id, visitor]]);
  const raw = parsePocketJson('{"msgIdServer":9007199254740993,"msgType":0,"msgTime":1792368000000,"bodys":"","extInfo":{"senderId":"2","messageType":"TEXT","text":"legacy member text"}}');
  const message = normalizeMessage(raw, owner, "room", directory);
  assert.equal(message?.id, "room:10:9007199254740993");
  assert.equal(message.memberId, visitor.id);
  assert.equal(message.roomOwnerId, owner.id);
  assert.equal(message.text, "legacy member text");
  assert.equal(normalizeMessage({ ...(raw as object), extInfo: { senderId: "999", roleId: 3 } }, owner, "room", directory), null);
  const reply = normalizeMessage({ msgIdClient: "reply", msgTime: 1792368000000, extInfo: { senderId: "1", messageObject: "faipaiText", faipaiContent: "public question", messageText: "member answer" } }, owner, "room", directory);
  assert.equal(reply?.question, "public question");
  assert.equal(reply.answer, "member answer");
  // Live 2026 responses wrap posts twice and use createAt/previewImg. The
  // previous parser silently skipped the entire member timeline.
  assert.deepEqual(contentList({ nextId: "0" }), []);
  assert.throws(() => contentList({ nextId: "123" }), /unknown content list shape/);
  const posts = contentList({ postsInfo: [{ type: "POST", data: { postsInfo: { postId: "large-post-id", userId: "1", createAt: "1792368000000", title: "Title", postContent: "Full member post", previewImg: [{ imgUrl: "https://source.48.cn/test.jpg", imgWidth: 640, imgHeight: 480 }] } } }] });
  const post = normalizeMessage(posts[0], owner, "posts", directory);
  assert.equal(post?.id, "post:large-post-id");
  assert.equal(post.text, "Title\nFull member post");
  assert.equal(post.images?.[0]?.width, 640);
  assert.equal(normalizeMessage({ imgId: "anonymous", imgUrl: "https://source.48.cn/test.jpg", createAt: "1792368000000" }, owner, "post_images", directory), null, "Catalog request parameters cannot invent member authorship");

});

// The old batch always fetched recordings, and daily runs resumed only old
// history. Exercise the actual state machine across a partial increment/restart.
test("keeps latest sync and history independent, with zero recording requests", async () => {
  const member = { id: "owner", name: "Owner", groupName: "SNH48" };
  const calls: (string | null)[] = [];
  const store = new DryRunStore();
  let saved = {
    source: "room" as const, historyCursor: "old-history", historyDone: false,
    latestAt: "2026-10-17T00:00:00.000Z", latestIds: ["old"], incrementalCursor: null as string | null,
    pendingLatestAt: null as string | null, pendingLatestIds: [] as string[],
    status: "ok" as const, lastError: null, lastSuccessAt: null, lastNonemptyAt: "2026-10-17T00:00:00.000Z",
  };
  store.getSyncState = async memberId => ({ memberId, messageCursor: null, recordingCursor: null, updatedAt: "", lastError: null, sources: [saved] });
  store.ingestUnit = async (unit: IngestUnit) => { assert.deepEqual(unit.recordings, []); if (unit.sync) saved = unit.sync as typeof saved; };
  const source = {
    listMembers: async () => [member],
    listMessages: async (_member: typeof member, cursor: string | null) => {
      calls.push(cursor);
      const at = cursor === "old-history" ? "2026-10-01T00:00:00.000Z" : cursor === "increment-tail" ? "2026-10-16T00:00:00.000Z" : "2026-10-19T00:00:00.000Z";
      return { items: [{ id: cursor ?? "new", memberId: member.id, occurredAt: at, type: "TEXT", text: "member text" }], nextCursor: cursor === null ? "increment-tail" : null };
    },
    listRecordings: async () => { throw new Error("Recording requests must be impossible from the batch"); },
  };
  await runBatch(source, store, { maxPagesPerMember: 1 });
  assert.equal(saved.latestAt, "2026-10-17T00:00:00.000Z", "unfinished increment must retain its old high watermark");
  assert.equal(saved.incrementalCursor, "increment-tail");
  assert.equal(saved.historyDone, true);
  assert.deepEqual(calls, [null, "old-history"]);
  calls.length = 0;
  await runBatch(source, store, { maxPagesPerMember: 1 });
  assert.deepEqual(calls, ["increment-tail"]);
  assert.equal(saved.latestAt, "2026-10-19T00:00:00.000Z");
  assert.equal(saved.incrementalCursor, null);
});

test("an empty room is reported as unverified without losing the batch", async () => {
  class EmptySource extends DemoSource {
    override async listMessages() { return { items: [], nextCursor: null }; }
  }
  const store = new DryRunStore();
  const result = await runBatch(new EmptySource(), store);
  assert.equal(result.errorCount, 1);
  assert.equal(result.membersCovered, 0);
  assert.equal(store.units.at(-2)?.sync?.historyDone, false);
});

// Album lookups recovered genuine room text after the room feed had failed,
// but that evidence was discarded from sync state and the room stayed unverified.
test("retains room verification from an album without hiding a failed history lookup", async () => {
  const store = new DryRunStore();
  const source = {
    sources: ["room", "album"] as const,
    listMembers: async () => [{ id: "1", name: "Owner", groupName: "SNH48" }],
    listMessages: async () => { throw new Error("History window unavailable"); },
    listContent: async (_member: unknown, stream: string) => {
      if (stream === "room") throw new Error("History window unavailable");
      return { items: [{ id: "recovered-room-text", memberId: "1", occurredAt: "2022-08-01T00:00:00.000Z", type: "TEXT", kind: "text" as const, sourceFlags: 1 }], nextCursor: null };
    },
  };
  const result = await runBatch(source, store, { maxHistoryPagesPerMember: 0 });
  const sync = store.units.filter(unit => unit.sync?.source === "room").at(-1)?.sync;
  assert.ok(sync?.lastNonemptyAt, "An attributable room original must remain recorded as verification evidence");
  assert.equal(sync.status, "failed", "Recovering nearby content does not prove the failed history window is complete");
  assert.equal(sync.lastError, "History window unavailable");
  assert.equal(sync.historyCursor, null);
  assert.equal(result.errorCount, 1);
  assert.equal(result.membersCovered, 1);
});

// Historical rooms can require several empty anchor pages before any timestamp
// boundary exists. The configured history budget must still be usable.
test("backfills across empty initial windows before observing a newest boundary", async () => {
  const member = { id: "1", name: "Owner", groupName: "SNH48" };
  const calls: (string | null)[] = [];
  const source = { listMembers: async () => [member], listMessages: async (_member: typeof member, cursor: string | null) => {
    calls.push(cursor);
    return cursor === "messages" ? { items: [{ id: "original", memberId: "1", type: "TEXT", occurredAt: "2022-08-01T00:00:00.000Z" }], nextCursor: "older" }
      : { items: [], nextCursor: cursor === null ? "anchor-page" : "messages" };
  } };
  const store = new DryRunStore();
  const result = await runBatch(source, store, { historyOnly: true, maxPagesPerMember: 1, maxHistoryPagesPerMember: 2 });
  assert.deepEqual(calls, [null, "anchor-page", "messages"]);
  assert.equal(result.messagesWritten, 1);
  assert.equal(store.units.filter(unit => unit.sync).at(-1)?.sync?.latestAt, "2022-08-01T00:00:00.000Z");
  assert.equal(store.units.filter(unit => unit.sync).at(-1)?.sync?.historyCursor, "older");
});

// Live albums omit sender IDs and may be months older than the latest room
// page. Resolve the original message, without trusting its displayed starName
// or attributing a reused image from a different timestamp.
test("verifies album authors from original room messages, including visiting members", async () => {
  const at = 1792368000000;
  let historical = false;
  const photo = (name: string) => `https://source.48.cn/${name}.jpg`;
  const original = (id: string, userId: string, time: number) => ({ msgIdServer: id, msgTime: time, msgType: "IMAGE", bodys: { url: photo(id) }, extInfo: { user: { userId } } });
  const makeSource = () => new Pocket48Source({ since: null, token: "synthetic", pa: "synthetic", minIntervalMs: 0, memberScope: "all", fetchImpl: async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const content = path.endsWith("/im/server/jump") ? historical ? { friend: true, star: true } : { channelId: 22, jumpServerInfo: { serverId: 33 } }
      : path.endsWith("/essence/message/list") ? {}
      : path.endsWith("/msg/list/img") ? { imgAndVideoList: [
        { starName: "SNH48-Owner", sourceType: "IMAGE", createTime: at, bodys: { url: photo("owner") } },
        { starName: "Visitor", sourceType: "IMAGE", createTime: at + 1000, bodys: { url: photo("visitor") } },
        { starName: "Owner", sourceType: "IMAGE", createTime: at + 2000, bodys: { url: photo("fan") } },
        { starName: "Owner", sourceType: "IMAGE", createTime: at + 3000, bodys: { url: photo("stale") } },
        { starName: "Owner", sourceType: "VIDEO", createTime: at + 4000, bodys: { url: "https://source.48.cn/video.mp4" } },
      ], nextTime: 0 }
      : (path.endsWith("/message/list/all") || path.endsWith("/message/list/homeowner")) ? { message: [
        original("owner", "1", at), original("visitor", "2", at + 1000),
        original("fan", "999", at + 2000), original("stale", "1", at - 1000),
        { msgIdServer: "video", msgTime: at + 4000, msgType: "VIDEO", bodys: { url: "https://source.48.cn/video.mp4" }, extInfo: { user: { userId: "2" } } },
        { msgIdServer: "nearby-text", msgTime: at - 2000, msgType: "TEXT", bodys: "verified nearby text", extInfo: { user: { userId: "1" } } },
      ].filter(row => row.msgTime < body.nextTime), nextTime: 0 }
      : null;
    return Response.json(content ? { status: 200, content } : { members: [{ id: "1", name: "Owner", channelId: 22, serverId: 33 }, { id: "2", name: "Visitor" }] });
  } });
  const source = makeSource();
  const members = await source.listMembers();
  const page = await source.listContent(members[0]!, "album", null);
  const catalog = page.items.filter(row => row.sourceFlags === 3);
  assert.deepEqual(catalog.map(row => [row.memberId, row.roomOwnerId]), [["1", "1"], ["2", "1"], ["2", "1"]]);
  assert.ok(page.items.every(row => row.id.startsWith("room:22:") && row.memberId !== "999"));
  assert.equal(catalog.find(row => row.kind === "video")?.videos?.[0]?.status, "pending");
  assert.equal(page.items.find(row => row.type === "TEXT")?.sourceFlags, 1, "Nearby room text must not masquerade as an album entry");
  assert.equal(page.unverified, 2, "Fan impersonation and wrong-time image reuse must remain unverified");
  // Chen Hongyu's historical album survives while jump is empty. Keep matched
  // owner content without promoting the candidate to a verified current room.
  historical = true;
  const archive = makeSource();
  const archivedMembers = await archive.listMembers();
  const archived = await archive.listContent(archivedMembers[0]!, "album", null);
  assert.ok(archived.items.some(row => row.sourceFlags === 3 && row.kind === "image"));
  assert.ok(archived.items.every(row => row.memberId === "1"), "An unconfirmed channel must not attribute visiting members to the selected owner");
  assert.equal(archived.unverified, 4);
  const roomPage = await archive.listMessages(archivedMembers[0]!, null);
  assert.ok(roomPage.items.length > 0);
  assert.ok(roomPage.items.every(row => row.memberId === "1"));
});

// Han Jiale's image catalog predates her latest text-only posts by months.
// Resolve nearby original posts, but never use the catalog's owner parameter
// as evidence that an image belongs to that member.
test("resolves old post images from original posts and retains unverified catalog entries", async () => {
  const member = { id: "1", name: "Owner", groupName: "SNH48" };
  const photo = (name: string) => `https://source.48.cn/${name}.jpg`;
  const time = 1754995019661;
  let lookups = 0;
  let verified: Awaited<ReturnType<Pocket48Source["listMessages"]>>["items"] = [];
  const source = new Pocket48Source({ since: null, token: "synthetic", pa: "synthetic", minIntervalMs: 0,
    readVerifiedPostImages: async () => verified,
    fetchImpl: async (url) => {
      if (String(url).endsWith("/posts/img/list")) return Response.json({ status: 200, content: { list: [
        { imgId: "1162096596169330688", imgUrl: photo("a"), createAt: time },
        { imgId: "1162096596169330687", imgUrl: photo("b"), createAt: time },
        { imgId: "1162096596169330686", imgUrl: photo("unverified"), createAt: time },
      ], next: "older-images" } });
      lookups++;
      return Response.json({ status: 200, content: { postsInfo: [
        { type: "POSTS", data: { postsInfo: { postId: "original", userId: "1", createAt: time + 7, postContent: "original member post", previewImg: [{ imgUrl: photo("a") }, { imgUrl: photo("b") }] } } },
        { type: "POSTS", data: { postsInfo: { postId: "other-author", userId: "2", createAt: time, previewImg: [{ imgUrl: photo("unverified") }] } } },
      ], nextId: "0" } });
    },
  });
  const page = await source.listContent(member, "post_images", null);
  assert.equal(page.unverified, 1, "An image owned only by a different author's post remains unverified");
  assert.equal(lookups, 1, "Images created together should share the original-post lookup");
  assert.ok(page.items.some(row => row.id === "post:original" && row.text === "original member post"));
  assert.ok(page.items.every(row => row.memberId === member.id));
  assert.equal(page.nextCursor, "older-images", "The catalog's pagination remains independent from post lookups");
  verified = page.items;
  await source.listContent(member, "post_images", null);
  assert.equal(lookups, 2, "Only the still-unverified image needs another lookup");
});

// Chen Hongyu's verified 2022 album originals use the older NIM CDN. Preserve
// their image bytes while continuing to reject unrelated source hosts.
test("uploads verified historical NIM images without accepting lookalike hosts", async () => {
  const bytes = Buffer.from("ffd8ffe000104a4649460001", "hex");
  let downloads = 0;
  const gallery = new GalleryUploader({ fetchImpl: async (url, init) => {
    if (!String(url).endsWith("/upload")) { downloads++; return new Response(bytes); }
    assert.ok(init?.body instanceof FormData);
    const file = init.body.get("file");
    assert.ok(file instanceof File);
    assert.equal(file.type, "image/jpeg");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
    return Response.json([{ src: "https://gallery.example/historical.jpg" }]);
  } });
  const image = { id: "historical-image", sourceUrl: "https://nim-nosdn.netease.im/original", galleryUrl: null, thumbnailUrl: null, width: null, height: null, status: "pending" as const };
  await gallery.upload(image);
  assert.equal(image.galleryUrl, "https://gallery.example/historical.jpg");
  await assert.rejects(gallery.upload({ ...image, sourceUrl: "https://nim-nosdn.netease.im.example/original" }), /source host/);
  assert.equal(downloads, 1);
});

// A production photo was served as image/jpeg but contained HEIC bytes, so it
// failed every retry. The original container must remain an image, not a video.
test("archives HEIC photos by their bytes despite misleading JPEG headers", async () => {
  const bytes = Buffer.from("000000186674797068656963000000006d696631686569630000202c6d657461", "hex");
  let uploads = 0;
  const gallery = new GalleryUploader({ fetchImpl: async (url, init) => {
    if (!String(url).endsWith("/upload")) return new Response(bytes, { headers: { "Content-Type": "image/jpeg" } });
    uploads++;
    assert.ok(init?.body instanceof FormData);
    const file = init.body.get("file");
    assert.ok(file instanceof File);
    assert.equal(file.type, "image/heic");
    assert.ok(file.name.endsWith(".heic"));
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
    return Response.json([{ src: "https://gallery.example/original.heic" }]);
  } });
  const image = { id: "heic-photo", sourceUrl: "https://kd48-nosdn.yunxinsvr.com/photo.jpg", galleryUrl: null, width: null, height: null, status: "pending" as const };
  await gallery.upload(image);
  assert.equal(image.status, "uploaded");
  await assert.rejects(gallery.uploadVideo({ ...image, galleryUrl: null }), /not a supported video/);
  assert.equal(uploads, 1, "HEIC data must not be uploaded under a video type");
});

// The size rule must hold when a CDN omits Content-Length or lies about it:
// reject oversized streamed bodies before any upload, and keep MP4 bytes intact.
test("bounds short-video downloads before uploading original MP4 bytes", async () => {
  const bytes = Buffer.from("00000018667479706d7034320000000069736f6d6d703432", "hex");
  let uploads = 0;
  let redirect = false;
  const gallery = new GalleryUploader({ fetchImpl: async (url, init) => {
    if (String(url).endsWith("/upload")) {
      uploads += 1;
      assert.ok(init?.body instanceof FormData);
      const file = init.body.get("file");
      assert.ok(file instanceof File);
      assert.equal(file.type, "video/mp4");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
      return Response.json([{ src: "https://gallery.example/short.mp4" }]);
    }
    if (redirect) return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } });
    if (init?.method === "HEAD") return new Response(null, { status: 405 });
    if ((init?.headers as Record<string, string>)?.Range) return new Response(bytes.subarray(0, 1), { status: 206, headers: { "Content-Range": `bytes 0-0/${bytes.length}` } });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 12)); controller.enqueue(bytes.subarray(12)); controller.close(); } }));
  } });
  const video = { id: "synthetic-video", sourceUrl: "https://kd48-nosdn.yunxinsvr.com/short-video", galleryUrl: null as string | null, thumbnailUrl: null as string | null, status: "pending" as const };
  assert.equal(await gallery.videoSize(video.sourceUrl), bytes.length);
  await assert.rejects(gallery.uploadVideo(video, bytes.length - 1), /size limit/);
  assert.equal(uploads, 0);
  assert.equal(await gallery.uploadVideo(video, bytes.length), bytes.length);
  assert.equal(video.galleryUrl, "https://gallery.example/short.mp4");
  assert.equal(uploads, 1);
  redirect = true;
  await assert.rejects(gallery.uploadVideo({ ...video, galleryUrl: null }), /source host/);
  assert.equal(uploads, 1, "Untrusted redirects must not result in uploads");
});

// Live followed member 37 was missing from the community directory, while
// system account 63 was incorrectly selected as a member. Only an explicit
// official member flag and matching ID can promote a missing account.
test("recovers followed members missing from the directory without admitting nonmembers", async () => {
  const source = new Pocket48Source({ since: null, token: "synthetic", pa: "synthetic", minIntervalMs: 0, fetchImpl: async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (!init?.body) return Response.json({ members: [{ id: "1", name: "Owner" }, { id: "63", name: "System" }] });
    if (path.endsWith("/friends/id")) return Response.json({ status: 200, content: { data: ["1", "37", "63", "999"] } });
    const { userId } = JSON.parse(String(init.body));
    return Response.json({ status: 200, content: { baseUserInfo: { userId, nickname: "Profile account", isStar: userId === "37" } } });
  } });
  assert.deepEqual((await source.listMembers()).map(member => member.id).sort(), ["1", "37"]);
});

// A real gallery outage can hold a page for minutes. If the process is lost
// during that upload, content must already exist, with no advanced checkpoint.
test("persists media-page text before uploading without advancing its checkpoint", async () => {
  const store = new DryRunStore();
  const member = { id: "owner", name: "Owner", groupName: "SNH48" };
  const image = { id: "image", sourceUrl: "https://source.48.cn/image.jpg", galleryUrl: null, thumbnailUrl: null, width: null, height: null, status: "pending" as const };
  const source = { listMembers: async () => [member], listMessages: async () => ({ items: [{ id: "post", memberId: member.id, occurredAt: "2026-10-19T00:00:00.000Z", type: "POST_INFO", kind: "post" as const, text: "member text", images: [image] }], nextCursor: "history" }) };
  let observed = false;
  const result = await runBatch(source, store, { maxPagesPerMember: 1, maxHistoryPagesPerMember: 0, archiveImage: async () => {
    const saved = store.units.find(unit => unit.messages[0]?.id === "post");
    assert.ok(saved);
    assert.equal(saved?.messages[0]?.text, "member text");
    assert.equal(saved.sync, undefined);
    assert.ok(!store.units.some(unit => unit.sync));
    observed = true;
    throw new Error("Gallery unavailable");
  } });
  assert.ok(observed);
  assert.equal(result.imageFailures, 1);
  assert.equal(result.messagesWritten, 1);
  assert.equal(store.units.find(unit => unit.sync)?.sync?.historyCursor, "history");
});

// Gallery production logs exposed Telegram 429s as HTTP 200/[]; pausing only
// the failed file lets queued files keep hitting the same flood window.
test("pauses all queued gallery uploads after an empty success response and retries", async context => {
  const start = Date.parse("2026-10-19T00:00:00Z");
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: start });
  const bytes = Buffer.from("00000018667479706d7034320000000069736f6d6d703432", "hex");
  const attempts: number[] = [];
  const gallery = new GalleryUploader({ fetchImpl: async url => {
    if (!String(url).endsWith("/upload")) return new Response(bytes);
    attempts.push(Date.now());
    return Response.json(attempts.length === 1 ? [] : [{ src: "https://gallery.example/video.mp4" }]);
  } });
  const video = (id: string) => ({ id, sourceUrl: "https://kd48-nosdn.yunxinsvr.com/video", galleryUrl: null as string | null, thumbnailUrl: null as string | null, status: "pending" as const });
  const first = video("first");
  const second = video("second");
  const done = Promise.all([gallery.uploadVideo(first), gallery.uploadVideo(second)]);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(attempts, [start]);
  assert.equal(first.galleryUrl, null, "An empty response cannot mark a file uploaded");
  context.mock.timers.tick(29_999);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(attempts.length, 1, "Other waiting files must also respect the cooldown");
  context.mock.timers.tick(1);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(attempts, [start, start + 30_000]);
  context.mock.timers.tick(3100);
  await done;
  assert.deepEqual(attempts, [start, start + 30_000, start + 33_100]);
  assert.equal(first.galleryUrl, "https://gallery.example/video.mp4");
  assert.equal(second.galleryUrl, first.galleryUrl);
});

// Re-querying the oldest retry page can return only files already attempted,
// hiding the remaining queue. Failed files must not block either media kind.
test("drains both media queues past failed uploads without retrying a file twice", async () => {
  const images: ImageAttachment[] = ["a", "b", "c"].map(id => ({ id, sourceUrl: `https://source.48.cn/${id}.png`, status: "pending" }));
  const videos: VideoAttachment[] = Array.from({ length: 101 }, (_, i) => ({ id: `v${String(i).padStart(3, "0")}`, sourceUrl: `https://source.48.cn/${i}.mp4`, status: "pending" }));
  const store = Object.assign(new DryRunStore(), {
    pendingImages: async (limit: number, afterId = "") => images.filter(item => item.status !== "uploaded" && item.id > afterId).slice(0, limit),
    pendingVideos: async (limit: number, afterId = "") => videos.filter(item => item.status !== "uploaded" && item.id > afterId).slice(0, limit),
    saveImage: async () => {}, saveVideo: async () => {},
  });
  const attempted = new Set<string>();
  const archive = async (item: ImageAttachment | VideoAttachment) => {
    assert.equal(attempted.has(item.id), false, "A failed file must be attempted at most once per run");
    attempted.add(item.id);
    if (item.id === "a" || item.id === "v000") throw new Error("synthetic unavailable file");
    item.status = "uploaded";
  };
  const result = await retryMedia(store, { mediaOnly: true, imageLimit: 1, maxBatches: 4, archiveImage: archive, archiveVideo: archive });
  assert.equal(result.failures, 2);
  assert.ok([...images, ...videos].every(item => attempted.has(item.id)), "Later pages must remain reachable after failures");
  assert.ok([...images, ...videos].filter(item => item.status === "failed").every(item => ["a", "v000"].includes(item.id)));
});

// Historical room homepages can be empty while older album timestamps still
// return owner messages. Resume through blank windows without inventing authors.
test("traverses historical room windows and rejects stale unverified channels", async () => {
  const at = 1661327674734;
  const calls: number[] = [];
  const member = { id: "1", name: "Owner", groupName: "SNH48", channelId: "22", serverId: "33" };
  const source = new Pocket48Source({ since: null, token: "synthetic", pa: "synthetic", minIntervalMs: 0, fetchImpl: async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/jump")) return Response.json({ status: 200, content: {} });
    if (String(url).endsWith("/msg/list/img")) return Response.json({ status: 200, content: { imgAndVideoList: [{ createTime: at, bodys: { url: "https://source.48.cn/original.jpg" } }], nextTime: 0 } });
    if (String(url).includes("/essence/")) return Response.json({ status: 500 });
    if (String(url).endsWith("/im/search")) return Response.json({ status: 200, content: [] });
    calls.push(body.nextTime);
    return Response.json({ status: 200, content: { message: body.nextTime === at + 1 ? [
      { msgIdServer: "owner", msgTime: at, msgType: "TEXT", bodys: "older text", extInfo: { user: { userId: "1" } } },
      { msgIdServer: "fan", msgTime: at, msgType: "TEXT", bodys: "fan", extInfo: { user: { userId: "999" } } },
    ] : [], nextTime: body.nextTime === at + 1 ? 0 : body.nextTime } });
  } });
  const page = await source.listMessages(member, null);
  assert.deepEqual(page.items.map(row => row.id), ["room:22:owner"]);
  assert.ok(page.nextCursor?.startsWith("archive:"));
  assert.notEqual(page.nextCursor, `archive:${at + 1}:0`, "A terminal message window must not replay the same window");
  await assert.rejects(source.listMessages(member, page.nextCursor), /history.*unverified|anchors/i);
  assert.ok(calls.includes(at + 1));
});

// An unresolvable catalog row must remain retryable without holding every older
// catalog page hostage. The checkpoint advances only with durable queue storage.
test("retains unresolved catalog entries independently of discovery cursors", async () => {
  class QueueStore extends DryRunStore {
    queue = new Map<string, NonNullable<IngestUnit["catalog"]>[number]>();
    saved: IngestUnit["sync"];
    override async getSyncState(memberId: string) { return { memberId, messageCursor: null, recordingCursor: null, updatedAt: "", lastError: null, sources: this.saved ? [this.saved] : [] }; }
    override async ingestUnit(unit: IngestUnit) { await super.ingestUnit(unit); if (unit.sync) this.saved = unit.sync; for (const entry of unit.catalog ?? []) this.queue.set(entry.id, entry); }
    async pendingCatalog() { return [...this.queue.values()].filter(entry => entry.status === "pending"); }
  }
  const store = new QueueStore();
  const entry = { id: "a".repeat(64), source: "album" as const, rawJson: "{}", status: "pending" as const };
  let pages = 0;
  const source = { sources: ["album"] as const, listMembers: async () => [{ id: "1", name: "Owner", groupName: "SNH48" }], listMessages: async () => {
    pages++; return { items: [], observed: 1, unverified: 1, boundary: [{ id: "image", occurredAt: "2022-08-01T00:00:00.000Z" }], nextCursor: "older", catalog: [entry] };
  } };
  const result = await runBatch(source, store, { maxPagesPerMember: 1, maxHistoryPagesPerMember: 0 });
  assert.equal(pages, 1);
  assert.equal(result.errorCount, 0, "Durably queued work is pending coverage, not a failed batch");
  assert.equal(result.scopeComplete, false);
  assert.equal(store.units.filter(unit => unit.sync).at(-1)?.sync?.historyCursor, "older");
  assert.equal(store.queue.get(entry.id)?.status, "pending");
  store.saved = { ...store.saved!, historyDone: true, historyCursor: null };
  const resumed = { ...source, retryCatalog: async () => ({ items: [], nextCursor: null, unverified: 0, catalog: [{ ...entry, status: "resolved" as const }] }) };
  const completed = await runBatch(resumed, store, { historyOnly: true });
  assert.equal(pages, 1, "Retrying a completed catalog must not restart discovery");
  assert.equal(completed.errorCount, 0);
  assert.equal(store.saved?.status, "ok", "Resolving the queue must clear its previous failed state");
  assert.equal(store.saved?.lastError, null);
});

// Fifty same-time fan messages can hide the original image on the next page.
// A separate homeowner feed can also return it when the all feed cannot.
test("finds album originals beyond the first page and in the homeowner feed", async () => {
  const at = 1661327674734;
  for (const mode of ["next-page", "homeowner"]) {
    const reads: string[] = [];
    const source = new Pocket48Source({ since: null, token: "synthetic", pa: "synthetic", minIntervalMs: 0, fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname; const body = JSON.parse(String(init?.body));
      if (path.endsWith("/jump")) return Response.json({ status: 200, content: { channelId: 22, serverId: 33 } });
      if (path.endsWith("/msg/list/img")) return Response.json({ status: 200, content: { imgAndVideoList: [{ createTime: at, bodys: { url: "https://source.48.cn/original.jpg" } }], nextTime: 0 } });
      reads.push(`${path.split("/").at(-1)}:${body.nextTime}`);
      const found = mode === "next-page" ? body.nextTime === at : path.endsWith("/homeowner");
      return Response.json({ status: 200, content: { message: found ? [{ msgIdServer: "original", msgTime: at, msgType: "IMAGE", bodys: { url: "https://source.48.cn/original.jpg" }, extInfo: { user: { userId: "1" } } }] : [{ msgIdServer: "fan", msgTime: mode === "next-page" ? at : at - 1000, msgType: "TEXT", bodys: "fan", extInfo: { user: { userId: "999" } } }], nextTime: mode === "next-page" && !found ? at : 0 } });
    } });
    const page = await source.listContent({ id: "1", name: "Owner", groupName: "SNH48" }, "album", null);
    assert.equal(page.unverified, 0); assert.equal(page.catalog?.[0]?.status, "resolved");
    assert.equal(page.items[0]?.memberId, "1");
    assert.ok(reads.includes(mode === "next-page" ? `all:${at}` : `homeowner:${at+1}`));
  }
});

// Same-time catalog images used to stop verification after the first match.
// A bounded run must retain the other lookup's position across source restarts.
test("resumes unresolved same-time album originals after the page budget", async () => {
  const at = 1661327674734;
  const member = { id: "1", name: "Owner", groupName: "SNH48" };
  const urls = ["https://source.48.cn/one.jpg", "https://source.48.cn/two.jpg"];
  const reads: number[] = [];
  const options = { since: null, token: "synthetic", pa: "synthetic", minIntervalMs: 0, albumOriginalPages: 1, fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url); const body = JSON.parse(String(init?.body));
    if (path.endsWith("/jump")) return Response.json({ status: 200, content: { channelId: 22, serverId: 33 } });
    if (path.endsWith("/msg/list/img")) return Response.json({ status: 200, content: { imgAndVideoList: urls.map(url => ({ createTime: at, bodys: { url } })), nextTime: 0 } });
    if (path.endsWith("/homeowner")) return Response.json({ status: 200, content: { message: [], nextTime: 0 } });
    reads.push(body.nextTime);
    const index = body.nextTime === at + 1 ? 0 : 1;
    return Response.json({ status: 200, content: { message: [{ msgIdServer: `image-${index}`, msgTime: at, msgType: "IMAGE", bodys: { url: urls[index] }, extInfo: { user: { userId: "1" } } }], nextTime: index === 0 ? at : 0 } });
  } };
  const first = await new Pocket48Source(options).listContent(member, "album", null);
  const pending = first.catalog!.filter(entry => entry.status === "pending");
  assert.equal(pending.length, 1);
  const retried = await new Pocket48Source(options).retryCatalog(member, "album", pending);
  assert.equal(retried.unverified, 0, "The second image must be reached rather than restarting the first page");
  assert.deepEqual(reads, [at + 1, at]);
  assert.equal(retried.catalog?.[0]?.id, pending[0]?.id, "Lookup progress must not change catalog identity");
  assert.equal(retried.catalog?.[0]?.status, "resolved");
});

// Accounts omitted from the modern directory may still have an official legacy
// room. Search ownership and returned sender IDs must both match independently.
test("reads legacy owner history without guessing room IDs or accepting fan authors", async () => {
  const source = new Pocket48Source({ since: null, token: "synthetic", pa: "synthetic", minIntervalMs: 0, fetchImpl: async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/jump")) return Response.json({ status: 200, content: {} });
    if (String(url).endsWith("/im/search")) return Response.json({ status: 200, content: [{ targetId: "wrong", ownerId: "2", targetType: 0 }, { targetId: "9911", ownerId: "1", targetType: 0 }] });
    assert.equal(body.roomId, "9911"); assert.equal(body.ownerId, "1");
    return Response.json({ status: 200, content: { message: [
      { msgIdServer: "old-owner", msgTime: 1661327674734, msgType: "TEXT", bodys: "old text", extInfo: { user: { userId: "1" } } },
      { msgIdServer: "fan", msgTime: 1661327674734, msgType: "TEXT", bodys: "fan", extInfo: { user: { userId: "999" } } },
    ], nextTime: 0 } });
  } });
  const page = await source.listMessages({ id: "1", name: "Owner", groupName: "SNH48" }, null);
  assert.deepEqual(page.items.map(message => message.id), ["room:9911:old-owner"]);
  assert.equal(page.nextCursor, "legacy:9911:end");
  await assert.rejects(source.listMessages({ id: "1", name: "Owner", groupName: "SNH48" }, page.nextCursor), /completeness remains unverified/);
});

// Real historical images survived in the legacy IMAGE feed while both modern
// message feeds returned empty. Different room namespaces must not hide them;
// the exact asset, millisecond timestamp, type and actual sender remain required.
test("verifies historical album media against legacy originals across room namespaces", async () => {
  const at = 1661327674734;
  const image = (name: string) => `https://source.48.cn/${name}.jpg`;
  const rows = ["match", "fan", "wrong-time"].map((name, index) => ({ sourceType: "IMAGE", createTime: at - index * 1000, bodys: { url: image(name) } }));
  rows.push({ sourceType: "VIDEO", createTime: at - 3000, bodys: { url: "https://source.48.cn/original.mp4" } });
  const original = (id: string, time: number, sender = "1") => ({ ...(id === "match" ? { serverId: "9007199254740993" } : {}), msgidClient: id, msgTime: time, msgType: "IMAGE", bodys: { url: image(id) }, extInfo: { user: { userId: sender } } });
  const source = new Pocket48Source({ since: null, token: "synthetic", pa: "synthetic", minIntervalMs: 0, fetchImpl: async (url, init) => {
    const path = String(url), body = JSON.parse(String(init?.body));
    if (path.endsWith("/jump")) return Response.json({ status: 200, content: {} });
    if (path.endsWith("/im/search")) return Response.json({ status: 200, content: [{ ownerId: "1", targetType: 0, targetId: "9911" }] });
    if (path.endsWith("/msg/list/img")) return Response.json({ status: 200, content: { imgAndVideoList: rows, nextTime: 0 } });
    if (path.endsWith("/aim/type")) {
      assert.equal(body.roomId, "9911");
      const message = body.extMsgType === "VIDEO" ? [{ msgidClient: "video", msgTime: at - 3000, msgType: "VIDEO", bodys: { url: "https://source.48.cn/original.mp4" }, extInfo: { user: { userId: "1" } } }]
        : body.nextTime === at + 1 ? [original("match", at)] : [original("fan", at - 1000, "999"), original("wrong-time", at - 9999)];
      return Response.json({ status: 200, content: { message, nextTime: body.extMsgType === "IMAGE" && body.nextTime === at + 1 ? at : 0 } });
    }
    return Response.json({ status: 200, content: { message: [], nextTime: body.nextTime } });
  } });
  const page = await source.listContent({ id: "1", name: "Owner", groupName: "SNH48", channelId: "22", serverId: "33" }, "album", null);
  assert.equal(page.unverified, 2);
  assert.equal(page.catalog?.filter(entry => entry.status === "resolved").length, 2);
  assert.ok(page.items.every(message => message.memberId === "1"));
  assert.ok(page.items.some(message => message.id === "room:22:9007199254740993"), "Legacy and modern originals must use the same exact server message ID");
  assert.deepEqual(page.items.filter(message => message.sourceFlags === 3).map(message => message.roomId), ["9911", "9911"]);
  assert.equal(page.items.find(message => message.id.endsWith(":wrong-time"))?.sourceFlags, 1, "A different timestamp must not resolve the catalog row");
});

// Some historical owners disappear from search. The owner-only public media
// feed still supplies sender IDs; neither a fan nor a guessed room is accepted.
test("resumes owner-only legacy media without assigning an invented room", async () => {
  const at = 1661327674734;
  const source = new Pocket48Source({ since: null, token: "synthetic", pa: "synthetic", minIntervalMs: 0, fetchImpl: async (url, init) => {
    const path = String(url), body = JSON.parse(String(init?.body));
    if (path.endsWith("/jump")) return Response.json({ status: 200, content: {} });
    if (path.endsWith("/im/search")) return Response.json({ status: 200, content: [{ targetId: "wrong", ownerId: "2", targetType: 0 }] });
    assert.equal(body.roomId, ""); assert.equal(body.ownerId, "1");
    return Response.json({ status: 200, content: { message: ["1", "999"].map(id => ({ msgidClient: id, msgTime: at, msgType: "IMAGE", bodys: { url: `https://source.48.cn/${id}.jpg` }, extInfo: { user: { userId: id } } })), nextTime: at - 1 } });
  } });
  const member = { id: "1", name: "Owner", groupName: "SNH48" };
  const page = await source.listMessages(member, null);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.roomId, null);
  assert.equal(page.items[0]?.id, "legacy-owner:1:1");
  assert.equal(page.nextCursor, `legacy-image:${at - 1}`);
  await assert.rejects(source.listMessages(member, page.nextCursor), /legacy media cursor/);
});
