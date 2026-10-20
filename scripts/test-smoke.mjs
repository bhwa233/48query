import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  start,
  freePort,
  apiDirectory,
  webDirectory,
} from "./lib/local-process.mjs";

const state = await mkdtemp(join(tmpdir(), "starter-smoke-"));
const servers = new Set();
function launch(args, options) {
  const server = start(args, options);
  servers.add(server);
  return server;
}
async function close(server) {
  await server.stop();
  servers.delete(server);
}
async function cleanup() {
  await Promise.allSettled([...servers].map((server) => server.stop()));
  await rm(state, { recursive: true, force: true });
}
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(1));
  });
}
async function request(origin, path, status = 200, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    signal: AbortSignal.timeout(20000),
    ...options,
  });
  const text = await response.text();
  assert.equal(response.status, status, `${path}: ${text.slice(0, 300)}`);
  return { response, text, json: () => JSON.parse(text) };
}
const post = (data, origin) => ({
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(origin ? { Origin: origin } : {}),
  },
  body: JSON.stringify(data),
});

try {
  const webPort = await freePort();
  const webOrigin = `http://localhost:${webPort}`;
  const web = launch(["exec", "vinext", "dev", "--port", String(webPort)], {
    cwd: webDirectory,
    env: { NEXT_PUBLIC_API_BASE_URL: "", NEXT_PUBLIC_SITE_URL: webOrigin },
  });
  await web.ready(`${webOrigin}/en`);
  const redirect = await request(webOrigin, "/", 308, { redirect: "manual" });
  assert.equal(
    new URL(redirect.response.headers.get("location"), webOrigin).pathname,
    "/en",
  );
  for (const [locale, lang] of [
    ["en", "en"],
    ["zh", "zh-CN"],
  ]) {
    const { text } = await request(webOrigin, `/${locale}`);
    assert.ok(text.includes(`lang="${lang}"`));
    assert.ok(
      !text.includes('id="note-title"'),
      "Standalone Web must not enable database forms",
    );
    const list = await request(webOrigin, `/${locale}/articles`);
    assert.ok(list.text.includes(`/${locale}/articles/welcome`));
    const article = await request(webOrigin, `/${locale}/articles/welcome`);
    assert.ok(article.text.includes("<article"));
    await request(webOrigin, `/${locale}/articles/missing`, 404);
    const missing = await request(webOrigin, `/${locale}/unknown`, 404);
    assert.ok(
      missing.text.includes(locale === "zh" ? "页面不存在" : "Page not found"),
    );
    assert.ok(missing.text.includes(`lang="${lang}"`));
  }
  for (const path of ["/robots.txt", "/sitemap.xml", "/favicon.svg"])
    await request(webOrigin, path);
  const sitemap = await request(webOrigin, "/sitemap.xml");
  assert.ok(sitemap.text.includes("/zh/articles/welcome"));
  console.log(
    "PASS standalone Web: locales, redirects, content/MDX, localized 404, metadata routes",
  );
  await close(web);

  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const baseArgs = [
    "exec",
    "wrangler",
    "dev",
    "--port",
    String(port),
    "--inspector-port",
    "0",
    "--persist-to",
    state,
    "--var",
    `CORS_ORIGINS:${webOrigin}`,
  ];
  const api = launch(baseArgs, { cwd: apiDirectory });
  await api.ready(`${origin}/api/health`);
  assert.equal(
    (await request(origin, "/api/health")).json().databaseConfigured,
    false,
  );
  for (const options of [{}, post({ title: "no binding" })]) {
    assert.equal(
      (await request(origin, "/api/notes", 503, options)).json().error.code,
      "database_not_configured",
    );
  }
  const echo = await request(
    origin,
    "/api/echo",
    200,
    post({ message: "  启动验证  " }, webOrigin),
  );
  assert.equal(echo.json().data.message, "启动验证");
  assert.equal(
    echo.response.headers.get("access-control-allow-origin"),
    webOrigin,
  );
  const denied = await request(origin, "/api/health", 200, {
    headers: { Origin: "https://untrusted.invalid" },
  });
  assert.equal(
    denied.response.headers.get("access-control-allow-origin"),
    null,
  );
  await request(origin, "/api/echo", 204, {
    method: "OPTIONS",
    headers: {
      Origin: webOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  await request(origin, "/api/echo", 400, post({ message: " " }));
  await request(origin, "/api/echo", 400, { ...post({}), body: "{" });
  await request(origin, "/api/echo", 413, post({ message: "x".repeat(17000) }));
  const notFound = await request(origin, "/api/missing", 404);
  assert.equal(notFound.json().error.code, "not_found");
  await request(origin, "/docs");
  assert.ok((await request(origin, "/openapi.json")).json().paths["/api/echo"]);
  console.log(
    "PASS no-D1 API: echo, validation, JSON errors, body limit, CORS, docs, missing binding",
  );
  await close(api);

  const dbArgs = [...baseArgs, "--config", "wrangler.d1.jsonc"];
  dbArgs.push("--var", "INGEST_KEY:test-ingest-key");
  let database = launch(dbArgs, { cwd: apiDirectory });
  await database.ready(`${origin}/api/health`);
  assert.equal(
    (await request(origin, "/api/health")).json().databaseConfigured,
    true,
  );
  assert.equal(
    (await request(origin, "/api/notes", 503)).json().error.code,
    "database_not_initialized",
  );
  assert.equal((await request(origin, "/api/query/ingest/progress?since=2025-12-31T16%3A00%3A00.000Z", 503, { headers: { "X-Ingest-Key": "test-ingest-key" } })).json().error.code, "collector_progress_not_configured");
  await close(database);
  const migration = launch(
    [
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "APP_DB",
      "--config",
      "wrangler.d1.jsonc",
      "--local",
      "--persist-to",
      state,
    ],
    { cwd: apiDirectory },
  );
  await migration.complete();
  servers.delete(migration);
  database = launch(dbArgs, { cwd: apiDirectory });
  await database.ready(`${origin}/api/health`);
  assert.deepEqual((await request(origin, "/api/notes")).json().data, []);
  const created = (
    await request(
      origin,
      "/api/notes",
      201,
      post({ title: "  isolated D1 regression  " }),
    )
  ).json().data;
  assert.equal(created.title, "isolated D1 regression");
  const notes = await request(origin, "/api/notes");
  assert.equal(notes.response.headers.get("cache-control"), "no-store");
  assert.ok(notes.json().data.some((note) => note.id === created.id));
  await request(origin, "/api/notes", 400, post({ title: "" }));
  await request(origin, "/api/query/ingest/unit", 401, post({}));
  const ingestUnit = {
    batchId: "smoke-batch",
    statDate: "2026-10-17",
    startedAt: "2026-10-18T00:00:00.000Z",
    member: { id: "smoke-member", name: "Smoke Member", pinyin: "smokemember", groupName: "SNH48", team: "Team SII", roomId: "smoke-room" },
    messages: [
      { id: "smoke-message", memberId: "smoke-member", occurredAt: "2026-10-17T12:00:00.000Z", senderId: "smoke-member", type: "POST_INFO", kind: "post", source: "posts", sourceFlags: 8, text: "smoke ingest full body", images: [{ id: "smoke-image", sourceUrl: "https://source.48.cn/smoke.png", status: "pending" }] },
      { id: "smoke-message-2", memberId: "smoke-member", occurredAt: "2026-10-17T12:00:00.000Z", type: "REPLY", kind: "reply", text: "smoke ingest two", question: "public smoke question", answer: "smoke ingest two" },
    ],
    recordings: [],
    messageCursor: null,
    recordingCursor: null,
    totalMembers: 1,
    membersCovered: 1,
    errorCount: 0,
  };
  const ingestOptions = { ...post(ingestUnit), headers: { ...post(ingestUnit).headers, "X-Ingest-Key": "test-ingest-key" } };
  const ingest = await request(origin, "/api/query/ingest/unit", 200, ingestOptions);
  assert.equal(ingest.json().data.messagesWritten, 2);
  assert.equal(ingest.response.headers.get("Cache-Control"), "no-store");
  await request(origin, "/api/query/ingest/unit", 400, { ...ingestOptions, body: JSON.stringify({ ...ingestUnit, recordings: [{ id: "excluded-recording" }] }) });
  const imageOptions = { headers: { "X-Ingest-Key": "test-ingest-key" } };
  // A killed runner must resume scoped cursors from D1. A stale writer cannot
  // rewind them, and a different date scope must never inherit completion.
  const progressPath = "/api/query/ingest/progress";
  const since = "2025-12-31T16:00:00.000Z";
  const scoped = { memberId: "smoke-member", since, revision: 0,
    sources: [{ source: "room", historyCursor: "older", historyDone: false, latestAt: "2026-10-17T00:00:00.000Z", latestIds: ["smoke-message"], incrementalCursor: null, pendingLatestAt: null, pendingLatestIds: [], status: "ok", lastError: null, lastSuccessAt: "2026-10-18T00:00:00.000Z", lastNonemptyAt: "2026-10-18T00:00:00.000Z" }],
    lastAttemptAt: "2026-10-18T00:00:00.000Z", lastIncrementalAt: "2026-10-18T00:00:00.000Z", lastHistoryAt: null, collectedAt: null, scopeComplete: false, errorCount: 0 };
  const saveProgress = value => ({ ...post(value), headers: { ...imageOptions.headers, "Content-Type": "application/json" } });
  assert.equal((await request(origin, progressPath, 200, saveProgress(scoped))).json().data.revision, 1);
  await request(origin, progressPath, 409, saveProgress(scoped));
  const readProgress = scope => `${progressPath}?since=${encodeURIComponent(scope)}`;
  const restored = (await request(origin, readProgress(since), 200, imageOptions)).json().data[0];
  assert.equal(restored.sources[0].historyCursor, "older");
  assert.equal(restored.revision, 1);
  assert.deepEqual((await request(origin, readProgress("2026-01-01T00:00:00.000Z"), 200, imageOptions)).json().data, []);
  const advanced = { ...restored, sources: [{ ...restored.sources[0], historyCursor: "oldest" }] };
  assert.equal((await request(origin, progressPath, 200, saveProgress(advanced))).json().data.revision, 2);
  await request(origin, progressPath, 409, saveProgress(restored));
  assert.equal((await request(origin, readProgress(since), 200, imageOptions)).json().data[0].sources[0].historyCursor, "oldest");
  assert.deepEqual((await request(origin, "/api/query/ingest/state/smoke-member", 200, imageOptions)).json().data.sources, [], "Scoped progress must not replace all-history checkpoints");
  console.log("PASS scoped collector progress: durable resume, scope isolation and stale writer rejection");
  const pendingEntry = { id: "a".repeat(64), source: "album", rawJson: JSON.stringify({ createTime: 1661327674734, bodys: { url: "https://source.48.cn/unverified.jpg" } }), status: "pending" };
  const catalogPath = "/api/query/ingest/catalog?memberId=smoke-member&source=album&limit=50";
  await request(origin, catalogPath, 401);
  await request(origin, "/api/query/ingest/unit", 200, { ...ingestOptions, body: JSON.stringify({ ...ingestUnit, catalog: [pendingEntry], messageCursor: "older-catalog" }) });
  assert.equal((await request(origin, catalogPath, 200, imageOptions)).json().data[0].id, pendingEntry.id);
  const continuedEntry = { ...pendingEntry, rawJson: JSON.stringify({ format: "pocket48-album-lookup-v1", item: JSON.parse(pendingEntry.rawJson), originalCursors: { all: 1661327674734 } }) };
  await request(origin, "/api/query/ingest/unit", 200, { ...ingestOptions, body: JSON.stringify({ ...ingestUnit, catalog: [continuedEntry], messageCursor: "older-catalog" }) });
  assert.equal((await request(origin, catalogPath, 200, imageOptions)).json().data[0].rawJson, continuedEntry.rawJson, "Updated original lookup cursors must survive a D1 upsert");
  assert.equal((await request(origin, "/api/query/ingest/state/smoke-member", 200, imageOptions)).json().data.messageCursor, "older-catalog");
  const lookupProgress = JSON.stringify({ format: "pocket48-album-lookup-v1", item: JSON.parse(pendingEntry.rawJson), originalCursors: { all: 1661327674734 } });
  await request(origin, "/api/query/ingest/unit", 200, { ...ingestOptions, body: JSON.stringify({ ...ingestUnit, catalog: [{ ...pendingEntry, rawJson: lookupProgress }] }) });
  await request(origin, "/api/query/ingest/unit", 200, { ...ingestOptions, body: JSON.stringify({ ...ingestUnit, catalog: [pendingEntry] }) });
  assert.equal((await request(origin, catalogPath, 200, imageOptions)).json().data[0].rawJson, lookupProgress, "Rediscovery must not reset a pending original's pagination progress");
  assert.equal((await request(origin, "/api/query/messages?q=unverified")).json().data.length, 0, "Unattributed queue entries must stay private");
  await request(origin, "/api/query/ingest/unit", 200, { ...ingestOptions, body: JSON.stringify({ ...ingestUnit, catalog: [{ ...pendingEntry, status: "resolved" }] }) });
  await request(origin, "/api/query/ingest/unit", 200, { ...ingestOptions, body: JSON.stringify({ ...ingestUnit, catalog: [pendingEntry] }) });
  assert.equal((await request(origin, catalogPath, 200, imageOptions)).json().data.length, 0, "Replayed discovery must not reopen a resolved item");
  console.log("PASS private catalog queue: authenticated, durable, unpublished and idempotent");
  const imageCache = (await request(origin, "/api/query/ingest/images/smoke-image", 200, imageOptions)).json().data;
  assert.equal(imageCache.status, "pending");
  await request(origin, "/api/query/ingest/images/smoke-image", 200, { ...post({ ...imageCache, status: "uploaded", galleryUrl: "https://gallery233.pages.dev/smoke.png" }), headers: { ...imageOptions.headers, "Content-Type": "application/json" } });
  await request(origin, "/api/query/ingest/unit", 200, { ...ingestOptions, body: JSON.stringify({ ...ingestUnit, messages: [{ ...ingestUnit.messages[0], source: "essence", sourceFlags: 4, text: "smoke preview" }] }) });
  const imageResults = (await request(origin, "/api/query/messages?kind=image&source=essence")).json().data;
  assert.equal(imageResults.length, 1);
  assert.equal(imageResults[0].text, "smoke ingest full body", "a secondary-source preview must not replace the full post body");
  assert.equal(imageResults[0].images[0].galleryUrl, "https://gallery233.pages.dev/smoke.png");
  const firstPage = (await request(origin, "/api/query/messages?limit=1")).json();
  const secondPage = (await request(origin, `/api/query/messages?limit=1&before=${encodeURIComponent(firstPage.nextCursor)}`)).json();
  assert.notEqual(firstPage.data[0].id, secondPage.data[0].id, "same-timestamp messages must remain pageable");
  assert.equal(secondPage.nextCursor, null);
  const quoted = (await request(origin, "/api/query/messages?q=public%20smoke%20question")).json().data;
  assert.equal(quoted[0].id, "smoke-message-2");
  await request(origin, "/api/query/ingest/batches/smoke-batch/complete", 200, { ...post({ completedAt: "2026-10-18T00:01:00.000Z", membersCovered: 1, totalMembers: 1, errorCount: 0 }), headers: { "Content-Type": "application/json", "X-Ingest-Key": "test-ingest-key" } });
  const syncState = await request(origin, "/api/query/ingest/state/smoke-member", 200, { headers: { "X-Ingest-Key": "test-ingest-key" } });
  assert.equal(syncState.json().data.memberId, "smoke-member");
  const overview = await request(origin, "/api/query/overview?date=2026-10-17");
  assert.deepEqual(overview.json().data.totals, { messages: 2, activeMembers: 1, recordings: 0, danmaku: 0, images: 1, imageMessages: 1, replies: 1 });
  assert.equal(overview.json().coverage.status, "partial");
  const failedCollector = launch(
    ["--filter", "@starter/collector", "exec", "tsx", "../../tests/collector/failure.ts"],
    { env: { INGEST_API_URL: origin, INGEST_KEY: "test-ingest-key" } },
  );
  console.log(await failedCollector.complete());
  servers.delete(failedCollector);
  const members = (await request(origin, "/api/query/members")).json().data;
  assert.equal(members[0].id, "smoke-member");
  assert.deepEqual({ messages: members[0].messages, recordings: members[0].recordings }, { messages: 2, recordings: 0 });
  const memberDetail = (await request(origin, "/api/query/members/smoke-member")).json().data;
  assert.deepEqual({ messages: memberDetail.messages, recordings: memberDetail.recordings }, { messages: 2, recordings: 0 });
  const messageResults = (await request(origin, "/api/query/messages?q=smoke&limit=5")).json().data;
  assert.deepEqual(messageResults.map((item) => item.id).sort(), ["smoke-message", "smoke-message-2"]);
  // A replayed source page must not erase an uploaded video's URL/byte count;
  // oversized videos stay queryable without entering the retry queue forever.
  const video = { id: "smoke-video", sourceUrl: "https://source.48.cn/short.mp4", galleryUrl: "https://gallery233.pages.dev/short.mp4", status: "uploaded", bytes: 2048 };
  const videoMessage = { id: "smoke-video-message", memberId: "smoke-member", senderId: "smoke-member", roomId: "verified-smoke-room", type: "VIDEO", kind: "video", occurredAt: "2026-10-17T12:00:01.000Z", videos: [video] };
  const videoPage = { ...ingestUnit, messages: [videoMessage, { ...videoMessage, id: "smoke-large-video-message", videos: [{ ...video, id: "smoke-large-video", galleryUrl: null, status: "skipped", bytes: 60 * 1024 * 1024, skipReason: "too_large" }] }] };
  await request(origin, "/api/query/ingest/unit", 200, { ...ingestOptions, body: JSON.stringify(videoPage) });
  await request(origin, "/api/query/ingest/unit", 200, { ...ingestOptions, body: JSON.stringify({ ...videoPage, messages: [{ ...videoMessage, videos: [{ ...video, galleryUrl: null, status: "pending", bytes: null }] }] }) });
  const videoResults = (await request(origin, "/api/query/messages?kind=video")).json().data;
  assert.deepEqual(videoResults.find(message => message.id === videoMessage.id).videos[0], { ...video, thumbnailUrl: null, skipReason: null });
  assert.deepEqual((await request(origin, "/api/query/ingest/videos", 200, imageOptions)).json().data, []);
  const cacheRequest = (roomId, occurredAt = videoMessage.occurredAt) => ({ ...post({ scope: "room", roomId, assets: [{ id: video.id, occurredAt }] }), headers: { ...imageOptions.headers, "Content-Type": "application/json" } });
  const verified = (await request(origin, "/api/query/ingest/verified-media", 200, cacheRequest(videoMessage.roomId))).json().data;
  assert.deepEqual(verified.map(message => message.id), [videoMessage.id]);
  assert.deepEqual((await request(origin, "/api/query/ingest/verified-media", 200, cacheRequest("different-room"))).json().data, []);
  assert.deepEqual((await request(origin, "/api/query/ingest/verified-media", 200, cacheRequest(videoMessage.roomId, "2026-10-17T12:00:02.000Z"))).json().data, []);
  const postCache = memberId => ({ ...post({ scope: "posts", memberId, imageIds: ["smoke-image"] }), headers: { ...imageOptions.headers, "Content-Type": "application/json" } });
  assert.deepEqual((await request(origin, "/api/query/ingest/verified-media", 200, postCache("smoke-member"))).json().data.map(message => message.id), ["smoke-message"]);
  assert.deepEqual((await request(origin, "/api/query/ingest/verified-media", 200, postCache("another-member"))).json().data, []);
  const recordingResults = (await request(origin, "/api/query/recordings")).json().data;
  assert.deepEqual(recordingResults.map((item) => item.id).sort(), []);
  await request(origin, "/api/query/members/missing", 404);
  await request(origin, "/api/query/overview?date=invalid", 400);
  assert.ok((await request(origin, "/openapi.json")).json().paths["/api/query/overview"]);
  const largePage = launch(
    ["--filter", "@starter/collector", "exec", "tsx", "../../tests/collector/ingest.ts"],
    { env: { INGEST_API_URL: origin, INGEST_KEY: "test-ingest-key" } },
  );
  console.log(await largePage.complete());
  servers.delete(largePage);
  // Beijing midnight must include the start, exclude the next midnight, and
  // count two attachments once even after the message is replayed via essence.
  const rankingPage = { ...ingestUnit, batchId: "ranking-boundary", member: { id: "ranking-member", name: "Ranking Boundary", groupName: "Boundary", team: "Boundary team" }, messages: [
    { id: "ranking-before", memberId: "ranking-member", type: "TEXT", text: "before", occurredAt: "2024-01-01T15:59:59.999Z" },
    { id: "ranking-start", memberId: "ranking-member", type: "REPLY", kind: "reply", text: "start", occurredAt: "2024-01-01T16:00:00.000Z" },
    { id: "ranking-image", memberId: "ranking-member", type: "IMAGE", kind: "image", occurredAt: "2024-01-02T15:59:59.999Z", images: [
      { id: "ranking-image-a", sourceUrl: "https://source.48.cn/ranking-a.png" }, { id: "ranking-image-b", sourceUrl: "https://source.48.cn/ranking-b.png" },
    ] },
    { id: "ranking-end", memberId: "ranking-member", type: "TEXT", text: "end", occurredAt: "2024-01-02T16:00:00.000Z" },
  ] };
  const rankingOptions = { ...ingestOptions, body: JSON.stringify(rankingPage) };
  await request(origin, "/api/query/ingest/unit", 200, rankingOptions);
  await request(origin, "/api/query/ingest/unit", 200, { ...rankingOptions, body: JSON.stringify({ ...rankingPage, messages: [{ ...rankingPage.messages[2], source: "essence", sourceFlags: 4 }] }) });
  // A delayed replay must not replace a newer (possibly lower) count. Fan-only
  // members belong in the fan ranking even when they have no messages in range.
  for (const followerSnapshot of [
    { count: 100, observedAt: "2026-10-17T00:00:00.000Z" },
    { count: 90, observedAt: "2026-10-18T00:00:00.000Z" },
    { count: 200, observedAt: "2026-10-16T00:00:00.000Z" },
  ]) await request(origin, "/api/query/ingest/unit", 200, { ...rankingOptions, body: JSON.stringify({ ...rankingPage, messages: [], followerSnapshot }) });
  const fanOnly = { ...rankingPage, member: { ...rankingPage.member, id: "fan-only", name: "Fan Only" }, messages: [], followerSnapshot: { count: 0, observedAt: "2026-10-18T01:00:00.000Z" } };
  await request(origin, "/api/query/ingest/unit", 200, { ...rankingOptions, body: JSON.stringify(fanOnly) });
  await request(origin, "/api/query/ingest/unit", 200, { ...rankingOptions, body: JSON.stringify(fanOnly) });
  await request(origin, "/api/query/ingest/unit", 400, { ...rankingOptions, body: JSON.stringify({ ...fanOnly, followerSnapshot: { count: 1, observedAt: "2099-01-01T00:00:00.000Z" } }) });
  const dayRanking = (await request(origin, "/api/query/rankings?from=2024-01-02&to=2024-01-02&group=Boundary&team=Boundary%20team")).json().data;
  assert.deepEqual(dayRanking.totals, { messages: 2, activeMembers: 1, images: 2, replies: 1 });
  assert.deepEqual(dayRanking.dailyActivity, [{ date: "2024-01-02", count: 2 }]);
  assert.equal(dayRanking.members[0].activeDays, 1);
  assert.equal(dayRanking.members[0].images, 2);
  assert.equal(dayRanking.members[0].followers, 90);
  assert.equal(dayRanking.members.find(member => member.id === "fan-only").followers, 0);
  assert.equal(dayRanking.members.find(member => member.id === "fan-only").messages, 0);
  assert.deepEqual(dayRanking.followersCoverage, { membersCovered: 2, earliestObservedAt: "2026-10-18T00:00:00.000Z", latestObservedAt: "2026-10-18T01:00:00.000Z" });
  const allFans = (await request(origin, "/api/query/rankings?from=2026-10-17&to=2026-10-18")).json().data;
  assert.equal(allFans.members.find(member => member.id === "smoke-member").followers, null);
  const expandedRanking = (await request(origin, "/api/query/rankings?from=2024-01-02&to=2024-01-03&group=Boundary")).json().data;
  assert.equal(expandedRanking.members[0].messages, 3);
  assert.equal(expandedRanking.members[0].activeDays, 2);
  assert.equal((await request(origin, "/api/query/rankings?from=2024-01-02&to=2024-01-03&group=Boundary&team=other")).json().data.members.length, 0);
  for (const range of ["from=2024-01-03&to=2024-01-02", "from=2024-01-01&to=2025-02-01", "from=2024-02-30&to=2024-03-01", "from=2099-01-01&to=2099-01-02"])
    await request(origin, `/api/query/rankings?${range}`, 400);
  console.log("PASS rankings: Beijing ranges, image deduplication, latest fan snapshots, unknown vs zero, fan-only members and filter scope");
  // Ranking pages and their cursor must commit together; a partial refresh must
  // not replace the last complete published snapshot.
  const meleePage = { snapshotId: "10000000-0000-4000-8000-000000000001", periodId: 426, periodLabel: "Synthetic official period", observedAt: "2026-10-17T00:00:00.000Z", cursor: null, nextCursor: "2", entries: [{ memberId: "607515", name: "Synthetic One", rank: 1, score: 100 }] };
  const saveMelee = page => ({ ...ingestOptions, body: JSON.stringify(page) });
  await request(origin, "/api/query/ingest/melee", 200, saveMelee(meleePage));
  assert.equal((await request(origin, "/api/query/melee")).json().data.snapshot.complete, false);
  assert.equal((await request(origin, "/api/query/ingest/melee/426", 200, imageOptions)).json().data.nextCursor, "2");
  await request(origin, "/api/query/ingest/melee", 200, saveMelee({ ...meleePage, cursor: "2", nextCursor: null, entries: [{ memberId: "63566", name: "Synthetic Two", rank: 2, score: 90 }] }));
  await request(origin, "/api/query/ingest/melee", 409, saveMelee({ ...meleePage, entries: [{ ...meleePage.entries[0], score: 999 }] }));
  const refreshMelee = { ...meleePage, snapshotId: "10000000-0000-4000-8000-000000000002", observedAt: "2026-10-18T00:00:00.000Z", entries: [{ ...meleePage.entries[0], score: 200 }] };
  await request(origin, "/api/query/ingest/melee", 200, saveMelee(refreshMelee));
  const publishedMelee = (await request(origin, "/api/query/melee?periodId=426")).json().data;
  assert.equal(publishedMelee.snapshot.complete, true);
  assert.equal("nextCursor" in publishedMelee.snapshot || "snapshotId" in publishedMelee.snapshot, false, "Public rankings must not expose private checkpoint identifiers");
  assert.equal(publishedMelee.entries.length, 2);
  assert.equal(publishedMelee.entries[0].score, 100);
  assert.equal(publishedMelee.entries[0].memberAvailable, false);
  assert.equal((await request(origin, "/api/query/ingest/melee/426", 200, imageOptions)).json().data.snapshotId, refreshMelee.snapshotId);
  await request(origin, "/api/query/ingest/melee", 200, saveMelee({ ...refreshMelee, cursor: "2", nextCursor: null, entries: [{ memberId: "63566", name: "Synthetic Two", rank: 2, score: 190 }] }));
  assert.equal((await request(origin, "/api/query/melee")).json().data.entries[0].score, 200);
  await request(origin, "/api/query/ingest/melee", 200, saveMelee({ ...meleePage, snapshotId: "10000000-0000-4000-8000-000000000003", observedAt: "2026-10-19T00:00:00.000Z", nextCursor: null, limited: true }));
  assert.equal((await request(origin, "/api/query/melee")).json().data.entries.length, 2, "A later limited response must not replace a complete ranking");
  assert.equal((await request(origin, "/api/query/ingest/melee/426", 200, imageOptions)).json().data.limited, true);
  assert.equal((await request(origin, "/api/query/melee?periodId=425")).json().data.snapshot, null);
  console.log("PASS weekly rankings: durable page resume, stale cursor rejection and atomic publication of complete refreshes");
  const datedMedia = { ...ingestUnit, messages: [{ id: "dated-media", memberId: "smoke-member", senderId: "smoke-member", type: "IMAGE", kind: "image", occurredAt: "2025-12-31T16:00:00.000Z", images: [{ id: "dated-media-image", sourceUrl: "https://source.48.cn/dated.png" }] }] };
  await request(origin, "/api/query/ingest/unit", 200, { ...ingestOptions, body: JSON.stringify(datedMedia) });
  const datedQueue = (await request(origin, `/api/query/ingest/images?since=${encodeURIComponent(since)}&afterId=`, 200, imageOptions)).json();
  assert.equal(datedQueue.since, since);
  assert.deepEqual(datedQueue.data.map(item => item.id), ["dated-media-image"], "Private queue includes the date boundary and excludes old ranking fixtures");
  console.log("PASS bounded dated media queue: eligible originals only, without rescanning public history");
  console.log(
    "PASS D1 API: uninitialized database, local migration, creation/readback, validation, no-store",
  );
  await close(database);

  const previewPort = await freePort();
  const previewOrigin = `http://localhost:${previewPort}`;
  const preview = launch(
    [
      "exec",
      "wrangler",
      "dev",
      "--config",
      "dist/server/wrangler.json",
      "--port",
      String(previewPort),
      "--inspector-port",
      "0",
      "--persist-to",
      join(state, "preview"),
    ],
    { cwd: webDirectory },
  );
  await preview.ready(`${previewOrigin}/en`);
  for (const path of [
    "/en",
    "/zh",
    "/zh/articles",
    "/en/articles/welcome",
    "/sitemap.xml",
  ])
    await request(previewOrigin, path);
  const missingPreview = await request(previewOrigin, "/zh/unknown", 404);
  assert.ok(missingPreview.text.includes("页面不存在"));
  const html = (await request(previewOrigin, "/en")).text;
  const assets = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  assert.ok(assets.length > 0, "Built Worker must reference client assets");
  for (const asset of assets) await request(previewOrigin, asset);
  console.log(
    `PASS built Web Worker: locales, MDX, 404 and ${assets.length} client assets`,
  );
} catch (error) {
  for (const server of servers) console.error(server.logs());
  throw error;
} finally {
  await cleanup();
}
