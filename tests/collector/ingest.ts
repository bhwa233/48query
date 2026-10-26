import assert from "node:assert/strict";
import { HttpIngestStore } from "../../apps/collector/src/http-store";
import type { IngestUnit } from "../../apps/collector/src/types";
import { collectionSince, openScopedCheckpoints } from "../../apps/collector/src/collection-scope";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { GroupProgress } from "../../apps/collector/src/group-progress";

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

// Simulate a new runner with no artifact/local file: the collector transport
// must recover the same source cursor from the actual private D1 API.
const progressDirectory = await mkdtemp(join(tmpdir(), "collector-resume-"));
try {
  const since = collectionSince();
  const legacyBefore = await store.getSyncState(unit.member.id);
  const scopedStore = new HttpIngestStore(endpoint, key, since);
  const first = await openScopedCheckpoints(join(progressDirectory, "first.json"), since, scopedStore);
  let lostProgressReply = false;
  globalThis.fetch = async (url, options) => {
    const response = await originalFetch(url, options);
    if (!lostProgressReply && options?.method === "POST" && String(url).endsWith("/ingest/progress") && response.ok) {
      lostProgressReply = true;
      await response.body?.cancel();
      return new Response('{"ok":', { status: 200 });
    }
    return response;
  };
  try {
  await first.write(unit.member.id, { source: "posts", historyCursor: "durable-older", historyDone: false,
    latestAt: null, latestIds: [], incrementalCursor: null, pendingLatestAt: null, pendingLatestIds: [],
    status: "ok", lastError: null, lastSuccessAt: null, lastNonemptyAt: null });
  } finally { globalThis.fetch = originalFetch; }
  assert.ok(lostProgressReply);
  assert.equal((await scopedStore.collectionProgress()).get(unit.member.id)?.revision, 1, "A lost reply must confirm the original commit, not apply a second revision");
  const resumed = await openScopedCheckpoints(join(progressDirectory, "new-runner.json"), since, new HttpIngestStore(endpoint, key, since));
  assert.equal(resumed.read(unit.member.id)[0]?.historyCursor, "durable-older");
  assert.equal((await store.getSyncState(unit.member.id)).messageCursor, legacyBefore.messageCursor);
  const otherSince = collectionSince("2026-02-01T00:00:00+08:00");
  const other = await openScopedCheckpoints(join(progressDirectory, "other-scope.json"), otherSince, new HttpIngestStore(endpoint, key, otherSince));
  assert.deepEqual(other.read(unit.member.id), []);
  console.log("PASS collector transport: fresh runner restores D1 cursor without touching all-history state");
  // Run 39898269151 exposed a real FK failure: the targeted CLI attached its
  // health counter ID as a run_id without registering that monitored run.
  // Launch the actual CLI against the smoke runner's real migrated local D1.
  const report = join(progressDirectory, "cli-health.json");
  const tsx = createRequire(new URL("../../apps/collector/package.json", import.meta.url)).resolve("tsx");
  // The earlier first-failure fixture intentionally isolated this demo source.
  await promisify(execFile)(process.execPath, ["--import", tsx, new URL("../../apps/collector/src/cli.ts", import.meta.url).pathname, "--retry-skipped"], {
    env: { ...process.env, COLLECTOR_SOURCE: "demo", COLLECTOR_MAX_PAGES: "1", COLLECTOR_MAX_MEMBERS: "1", COLLECTOR_HISTORY_PAGES: "0",
      COLLECTOR_REPORT_PATH: report, GITHUB_STEP_SUMMARY: "", GITHUB_RUN_ID: "smoke-targeted-cli", GITHUB_RUN_ATTEMPT: "1" }, timeout: 20000,
  });
  const cliHealth = JSON.parse(await readFile(report, "utf8"));
  assert.equal(cliHealth.interrupted, false);
  assert.equal(cliHealth.execution, "completed");
  assert.equal(cliHealth.failures, 0);
  console.log("PASS targeted collector CLI: health invocation ID does not create an unregistered task foreign key");

  // Scheduled run 39903245375 failed on an identity ambiguity and an untouched
  // old isolation. Exercise the actual group CLI, persisted local D1 state and
  // final report together; source-only tests cannot catch the group catch path.
  const groupPath = join(progressDirectory, "group.json");
  const groupReport = join(progressDirectory, "group-health.json");
  const candidate = { name: "Namesake", officialIds: ["10020"], officialPocketIds: [], candidateIds: ["4", "530431"], groups: ["SNH48"], teams: [], officialStatuses: [] };
  const dueMember = { id: "smoke-group-recovery", name: "Recovery", groupName: "SNH48" };
  const groupState: GroupProgress = { version: 1, since, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    rosterRefreshedAt: "2026-10-22T00:43:22.223Z", rosterFailures: 3, officialRows: 2, excluded: [], entries: [
    { candidate, member: null, identity: "pending" },
    { candidate: { ...candidate, name: dueMember.name, candidateIds: [dueMember.id] }, member: dueMember, identity: "verified", scopeComplete: false,
      sources: [{ source: "posts", historyCursor: null, historyDone: false, latestAt: null, latestIds: [], incrementalCursor: null,
        pendingLatestAt: null, pendingLatestIds: [], status: "failed", lastError: "Pocket48 unknown content list shape.",
        lastSuccessAt: null, lastNonemptyAt: null, skippedAt: "2026-10-21T00:00:00Z", nextRetryAt: "2026-10-22T00:00:00Z",
        healthVersion: 1, failureKind: "protocol", failureCount: 3 }] },
    { candidate: { ...candidate, officialIds: ["legacy-identity"] }, member: null, identity: "failed",
      lastAttemptAt: new Date().toISOString(), identityError: "Multiple official Pocket48 identities match this name; manual reconciliation required." },
  ] };
  const pocket = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    let content: unknown;
    if (request.url === "/directory") content = { roomId: [] };
    else if (request.url?.startsWith("/malformed")) content = undefined;
    else if (request.url?.endsWith("/user/info/home")) content = { baseUserInfo: { userId: body.userId, nickname: "Namesake", isStar: true } };
    else if (request.url?.endsWith("/star/archives")) content = { starInfo: { starGroupName: "SNH48" } };
    else if (request.url?.endsWith("/getMeleeRankPage")) content = { weekRankList: [] };
    else if (request.url?.endsWith("/home/new")) content = { postsInfo: [], nextId: "0" };
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(request.url === "/directory" ? content : { status: 200, ...(content === undefined ? {} : { content }) }));
  });
  await new Promise<void>(resolve => pocket.listen(0, "127.0.0.1", resolve));
  const pocketUrl = `http://127.0.0.1:${(pocket.address() as AddressInfo).port}`;
  const groupEnv = { ...process.env, POCKET48_TOKEN: "synthetic", POCKET48_PA: "synthetic", POCKET48_API_BASE_URL: pocketUrl,
    COLLECTOR_CREDENTIALS_URL: "", COLLECTOR_CREDENTIAL_READ_TOKEN: "", COLLECTOR_SOURCES: "posts", POCKET48_MIN_INTERVAL_MS: "0",
    POCKET48_DIRECTORY_URL: `${pocketUrl}/directory`, POCKET48_HISTORY_DIRECTORY_URL: `${pocketUrl}/directory`,
    COLLECTOR_GROUP_STATE: groupPath, COLLECTOR_REPORT_PATH: groupReport, COLLECTOR_GROUP_LIMIT: "1", COLLECTOR_GROUP_MAX_SECONDS: "15",
    COLLECTOR_GROUP_WEEKLY_RECHECK: "1", GITHUB_STEP_SUMMARY: "", GITHUB_RUN_ID: "smoke-group-cli", GITHUB_RUN_ATTEMPT: "1" };
  // Run 40253364027 still committed content, but a persistent roster 502 alone
  // failed the job. Keep real local HTTP/D1 writes and intercept only that URL.
  const rosterOutage = `const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, options) => new URL(String(input)).hostname === "h5.48.cn"
      ? Promise.resolve(new Response(null, { status: 502 })) : originalFetch(input, options);`;
  const groupArgs = ["--import", tsx, "--import", `data:text/javascript,${encodeURIComponent(rosterOutage)}`,
    new URL("../../apps/collector/src/group.ts", import.meta.url).pathname, "--collect", "--update-roster"];
  try {
    await writeFile(groupPath, JSON.stringify(groupState));
    const { stdout } = await promisify(execFile)(process.execPath, groupArgs, { env: groupEnv, timeout: 20000 });
    const health = JSON.parse(await readFile(groupReport, "utf8"));
    const after = JSON.parse(await readFile(groupPath, "utf8")) as GroupProgress;
    assert.equal(health.execution, "degraded");
    assert.equal(health.runErrors, 0);
    assert.equal(health.sourceFailures, 0);
    assert.equal(health.rosterStatus, "cached");
    assert.equal(health.rosterRefreshedAt, groupState.rosterRefreshedAt, "A cached roster must not be reported as freshly fetched");
    assert.equal(after.rosterFailures, 3);
    assert.equal(health.recoveryProbes, 1);
    assert.equal(after.entries[0]?.identity, "unverified");
    assert.ok(after.entries[0]?.checkedAt);
    assert.equal(after.entries[2]?.identity, "unverified", "Known legacy ambiguity must migrate out of hard failure");
    assert.equal(after.entries[2]?.checkedAt, groupState.entries[2]?.lastAttemptAt, "Migration must preserve the real prior verification time");
    assert.equal(health.identityIssues[0]?.status, "unverified");
    assert.ok(health.identityIssues[0]?.nextCheckAt);
    assert.equal(after.entries[1]?.sources?.[0]?.failureCount, 0);
    assert.equal(after.entries[1]?.scopeComplete, false, "A successful probe does not certify all member sources/history");
    assert.ok(stdout.indexOf('"phase":"recovery"') < stdout.indexOf('"event":"group_identity_pending"'));
    const again = await promisify(execFile)(process.execPath, groupArgs, { env: { ...groupEnv, GITHUB_RUN_ATTEMPT: "2" }, timeout: 20000 });
    assert.ok(!again.stdout.includes('"event":"group_identity_pending"'), "An identity gap must not be checked again before its due date");
    // A malformed protocol response must still fail even when the persisted
    // source health is green. Previously health.failures overwrote run errors.
    const broken = JSON.parse(await readFile(groupPath, "utf8")) as GroupProgress;
    broken.entries.unshift({ candidate: { ...candidate, candidateIds: ["bad-profile"] }, member: null, identity: "pending" });
    await writeFile(groupPath, JSON.stringify(broken));
    await assert.rejects(promisify(execFile)(process.execPath, groupArgs, { env: { ...groupEnv, POCKET48_API_BASE_URL: `${pocketUrl}/malformed`, GITHUB_RUN_ATTEMPT: "3" }, timeout: 20000 }));
    const failedHealth = JSON.parse(await readFile(groupReport, "utf8"));
    assert.equal(failedHealth.execution, "failed");
    assert.ok(failedHealth.runErrors > 0);
    assert.equal(failedHealth.sourceFailures, 0);
    console.log("PASS group CLI: bounded due recovery, identity gap backoff, D1 persistence and distinct run/source errors");
  } finally {
    pocket.closeAllConnections();
    await new Promise<void>((resolve, reject) => pocket.close(error => error ? reject(error) : resolve()));
  }
} finally { await rm(progressDirectory, { recursive: true, force: true }); }
