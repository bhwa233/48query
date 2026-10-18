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
function launch(args, options) {
  const server = start(args, options);
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
    ],
    { cwd: apiDirectory },
  );
  await api.ready(`${apiOrigin}/api/health`);
  const web = launch(["exec", "vinext", "dev", "--port", String(webPort)], {
    cwd: webDirectory,
    env: {
      NEXT_PUBLIC_SITE_URL: webOrigin,
      NEXT_PUBLIC_API_BASE_URL: apiOrigin,
    },
  });
  await web.ready(`${webOrigin}/en`);
  const tests = launch(
    ["exec", "playwright", "test", ...process.argv.slice(2)],
    { env: { STARTER_E2E_WEB_URL: webOrigin } },
  );
  console.log(await tests.complete());
} catch (error) {
  for (const server of servers) console.error(server.logs());
  throw error;
} finally {
  await cleanup();
}
