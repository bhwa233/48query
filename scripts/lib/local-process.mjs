import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const apiDirectory = fileURLToPath(
  new URL("../../apps/api/", import.meta.url),
);
export const webDirectory = fileURLToPath(
  new URL("../../apps/web/", import.meta.url),
);

export async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

export function start(args, { cwd = root, env = {} } = {}) {
  const child = spawn("pnpm", args, {
    cwd,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", ...env },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  let spawnError;
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (data) => {
      logs = (logs + data.toString()).slice(-24000);
    });
  }
  child.on("error", (error) => {
    spawnError = error;
  });
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", () => resolve({ code: 1 }));
  });
  return {
    child,
    logs: () => logs,
    async ready(url, expectedStatus = 200) {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        if (spawnError || child.exitCode !== null || child.signalCode)
          throw new Error(
            `Server failed: ${spawnError ?? child.exitCode}\n${logs}`,
          );
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(2000),
            redirect: "manual",
          });
          await response.arrayBuffer();
          if (response.status === expectedStatus) return;
        } catch {
          /* Startup may not have bound the port yet. */
        }
        await delay(250);
      }
      throw new Error(`Timed out waiting for ${url}\n${logs}`);
    },
    async complete() {
      const result = await exited;
      if (result.code !== 0)
        throw new Error(
          `Command failed (${result.code}): pnpm ${args.join(" ")}\n${logs}`,
        );
      return logs;
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode || !child.pid) return;
      const signal = (name) => {
        try {
          if (process.platform === "win32") child.kill(name);
          else process.kill(-child.pid, name);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      };
      signal("SIGTERM");
      const stopped = await Promise.race([
        exited.then(() => true),
        delay(5000).then(() => false),
      ]);
      if (!stopped) {
        signal("SIGKILL");
        await exited;
      }
    },
  };
}
