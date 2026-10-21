import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  start,
  freePort,
  apiDirectory,
  webDirectory,
} from "./lib/local-process.mjs";

const state = await mkdtemp(join(tmpdir(), "starter-e2e-"));
const servers = [];
function launch(args, options = {}) {
  const server = start(args, { ...options, env: { ...options.env, WRANGLER_REGISTRY_PATH: join(state, "registry"), MINIFLARE_REGISTRY_PATH: join(state, "registry") } });
  servers.push(server);
  return server;
}
async function cleanup() {
  await Promise.allSettled(servers.toReversed().map((server) => server.stop()));
  await rm(state, { recursive: true, force: true });
}
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(1));
  });
try {
  const apiPort = await freePort();
  const webPort = await freePort();
  const webOrigin = `http://localhost:${webPort}`;
  const apiOrigin = `http://localhost:${apiPort}`;
  await launch(
    [
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "APP_DB",
      "--local",
      "--config",
      "wrangler.d1.jsonc",
      "--persist-to",
      state,
    ],
    { cwd: apiDirectory },
  ).complete();
  const api = launch(
    [
      "exec",
      "wrangler",
      "dev",
      "--config",
      "wrangler.d1.jsonc",
      "--port",
      String(apiPort),
      "--inspector-port",
      "0",
      "--persist-to",
      state,
      "--var",
      `CORS_ORIGINS:${webOrigin}`,
      "--var",
      "INGEST_KEY:test-e2e-ingest",
    ],
    { cwd: apiDirectory },
  );
  await api.ready(`${apiOrigin}/api/health`);
  const occurredAt = new Date(Date.now() - 86400_000).toISOString();
  const seed = await fetch(`${apiOrigin}/api/query/ingest/unit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Ingest-Key": "test-e2e-ingest" },
    body: JSON.stringify({ batchId: "e2e-archive", statDate: occurredAt.slice(0, 10), startedAt: occurredAt,
      member: { id: "e2e-member", name: "验证成员", pinyin: "syntheticmember", groupName: "SNH48", team: "Team SII" },
      followerSnapshot: { count: 300, observedAt: new Date().toISOString() },
      messages: [
        { id: "e2e-text", memberId: "e2e-member", senderId: "e2e-member", type: "TEXT", text: "验证文字归档", occurredAt },
        { id: "e2e-image", memberId: "e2e-member", senderId: "e2e-member", type: "IMAGE", kind: "image", occurredAt, images: [{ id: "e2e-image-asset", sourceUrl: `${webOrigin}/favicon.svg`, galleryUrl: `${webOrigin}/favicon.svg`, status: "uploaded" }] },
        { id: "e2e-reply", memberId: "e2e-member", senderId: "e2e-member", type: "REPLY", kind: "reply", text: "验证成员回答", question: "验证公开提问", answer: "验证成员回答", occurredAt },
      ], recordings: [], messageCursor: null, recordingCursor: null, totalMembers: 1, membersCovered: 1, errorCount: 0 }),
  });
  if (!seed.ok) throw new Error(`E2E archive seed failed: ${seed.status}`);
  const comparison = await fetch(`${apiOrigin}/api/query/ingest/unit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Ingest-Key": "test-e2e-ingest" },
    body: JSON.stringify({ batchId: "e2e-comparison", statDate: occurredAt.slice(0, 10), startedAt: occurredAt,
      member: { id: "e2e-comparison", name: "对照成员", pinyin: "picturemember", groupName: "GNZ48", team: "Team G" },
      followerSnapshot: { count: 500, observedAt: new Date().toISOString() },
      messages: [
        ...[1, 2].map(index => ({ id: `comparison-image-${index}`, memberId: "e2e-comparison", senderId: "e2e-comparison", type: "IMAGE", kind: "image", occurredAt,
          images: [{ id: `comparison-asset-${index}`, sourceUrl: `${webOrigin}/favicon.svg?image=${index}`, galleryUrl: `${webOrigin}/favicon.svg?image=${index}`, status: "uploaded" }] })),
        { id: "comparison-history", memberId: "e2e-comparison", senderId: "e2e-comparison", type: "TEXT", text: "早于七天的历史记录", occurredAt: new Date(Date.now() - 9 * 86400_000).toISOString() },
      ], recordings: [], totalMembers: 2, membersCovered: 2, errorCount: 0 }),
  });
  if (!comparison.ok) throw new Error(`E2E comparison seed failed: ${comparison.status}`);
  for (const [index, periodId] of [426, 425].entries()) {
    const melee = await fetch(`${apiOrigin}/api/query/ingest/melee`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Ingest-Key": "test-e2e-ingest" },
      body: JSON.stringify({ snapshotId: `20000000-0000-4000-8000-00000000000${index + 1}`, periodId, periodLabel: index ? "测试上一期" : "测试最新一期", observedAt: new Date().toISOString(), cursor: null, nextCursor: null, limited: index === 1,
        entries: [
          { memberId: "607515", name: "鸡腿验证一", rank: index ? 2 : 1, score: index ? 1000 : 1500 },
          { memberId: "63566", name: "鸡腿验证二", rank: index ? 1 : 2, score: index ? 2000 : 1000 },
        ] }),
    });
    if (!melee.ok) throw new Error(`E2E weekly ranking seed failed: ${melee.status}`);
  }
  const web = launch(["exec", "vinext", "dev", "--port", String(webPort)], {
    cwd: webDirectory,
    env: {
      NEXT_PUBLIC_SITE_URL: webOrigin,
      NEXT_PUBLIC_API_BASE_URL: "/",
    },
  });
  await web.ready(`${webOrigin}/en`);
  const tests = launch(
    ["exec", "playwright", "test", ...process.argv.slice(2)],
    { env: { STARTER_E2E_WEB_URL: webOrigin, STARTER_E2E_API_URL: apiOrigin, STARTER_E2E_D1_STATE: state } },
  );
  console.log(await tests.complete());
} catch (error) {
  for (const server of servers) console.error(server.logs());
  throw error;
} finally {
  await cleanup();
}
