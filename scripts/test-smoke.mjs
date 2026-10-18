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
