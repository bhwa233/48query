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
      { id: "smoke-message", memberId: "smoke-member", occurredAt: "2026-10-17T12:00:00.000Z", type: "TEXT", text: "smoke ingest" },
      { id: "smoke-message-2", memberId: "smoke-member", occurredAt: "2026-10-17T12:30:00.000Z", type: "TEXT", text: "smoke ingest two" },
    ],
    recordings: [
      { id: "smoke-recording", memberId: "smoke-member", title: "Smoke recording", occurredAt: "2026-10-17T13:00:00.000Z", durationSeconds: 60, danmakuCount: 3, danmakuStatus: "parsed" },
      { id: "smoke-recording-2", memberId: "smoke-member", title: "Smoke recording two", occurredAt: "2026-10-17T14:00:00.000Z", durationSeconds: 90, danmakuCount: 2, danmakuStatus: "pending" },
    ],
    messageCursor: null,
    recordingCursor: null,
    totalMembers: 1,
    membersCovered: 1,
    errorCount: 0,
  };
  const ingestOptions = { ...post(ingestUnit), headers: { ...post(ingestUnit).headers, "X-Ingest-Key": "test-ingest-key" } };
  const ingest = await request(origin, "/api/query/ingest/unit", 200, ingestOptions);
  assert.equal(ingest.json().data.messagesWritten, 2);
  await request(origin, "/api/query/ingest/batches/smoke-batch/complete", 200, { ...post({ completedAt: "2026-10-18T00:01:00.000Z", membersCovered: 1, totalMembers: 1, errorCount: 0 }), headers: { "Content-Type": "application/json", "X-Ingest-Key": "test-ingest-key" } });
  const syncState = await request(origin, "/api/query/ingest/state/smoke-member", 200, { headers: { "X-Ingest-Key": "test-ingest-key" } });
  assert.equal(syncState.json().data.memberId, "smoke-member");
  const overview = await request(origin, "/api/query/overview?date=2026-10-17");
  assert.deepEqual(overview.json().data.totals, { messages: 2, activeMembers: 1, recordings: 2, danmaku: 5 });
  assert.equal(overview.json().coverage.status, "complete");
  const members = (await request(origin, "/api/query/members")).json().data;
  assert.equal(members[0].id, "smoke-member");
  assert.deepEqual({ messages: members[0].messages, recordings: members[0].recordings }, { messages: 2, recordings: 2 });
  const memberDetail = (await request(origin, "/api/query/members/smoke-member")).json().data;
  assert.deepEqual({ messages: memberDetail.messages, recordings: memberDetail.recordings }, { messages: 2, recordings: 2 });
  const messageResults = (await request(origin, "/api/query/messages?q=smoke&limit=5")).json().data;
  assert.deepEqual(messageResults.map((item) => item.id).sort(), ["smoke-message", "smoke-message-2"]);
  const recordingResults = (await request(origin, "/api/query/recordings")).json().data;
  assert.deepEqual(recordingResults.map((item) => item.id).sort(), ["smoke-recording", "smoke-recording-2"]);
  await request(origin, "/api/query/members/missing", 404);
  await request(origin, "/api/query/overview?date=invalid", 400);
  assert.ok((await request(origin, "/openapi.json")).json().paths["/api/query/overview"]);
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
