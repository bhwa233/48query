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
  const dayRanking = (await request(origin, "/api/query/rankings?from=2024-01-02&to=2024-01-02&group=Boundary&team=Boundary%20team")).json().data;
  assert.deepEqual(dayRanking.totals, { messages: 2, activeMembers: 1, images: 2, replies: 1 });
  assert.deepEqual(dayRanking.dailyActivity, [{ date: "2024-01-02", count: 2 }]);
  assert.equal(dayRanking.members[0].activeDays, 1);
  assert.equal(dayRanking.members[0].images, 2);
  const expandedRanking = (await request(origin, "/api/query/rankings?from=2024-01-02&to=2024-01-03&group=Boundary")).json().data;
  assert.equal(expandedRanking.members[0].messages, 3);
  assert.equal(expandedRanking.members[0].activeDays, 2);
  assert.equal((await request(origin, "/api/query/rankings?from=2024-01-02&to=2024-01-03&group=Boundary&team=other")).json().data.members.length, 0);
  for (const range of ["from=2024-01-03&to=2024-01-02", "from=2024-01-01&to=2025-02-01", "from=2024-02-30&to=2024-03-01", "from=2099-01-01&to=2099-01-02"])
    await request(origin, `/api/query/rankings?${range}`, 400);
  console.log("PASS ranking ranges: Beijing midnight boundaries, image deduplication, active days, filter scope and invalid ranges");
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
