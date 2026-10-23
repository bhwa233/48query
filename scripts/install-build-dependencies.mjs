import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

// Workers Builds can fail while pnpm's version shim downloads its binary,
// before the project build command. Run this with SKIP_DEPENDENCY_INSTALL=1.
// Reuse the installed pnpm shim and pinned packageManager, not another installer.
for (let attempt = 0; attempt < 3; attempt++) {
  let diagnostic = "";
  const child = spawn("pnpm", ["install", "--frozen-lockfile"], { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  const forward = (target, chunk) => {
    target.write(chunk);
    diagnostic = (diagnostic + chunk.toString()).slice(-65536);
  };
  child.stdout.on("data", chunk => forward(process.stdout, chunk));
  child.stderr.on("data", chunk => forward(process.stderr, chunk));
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => resolve(code ?? 1));
  });
  if (exitCode === 0) break;
  // A frozen-lockfile or package compatibility error is deterministic. Retrying
  // those hides the actionable error and consumes the build's entire budget.
  const deterministic = /ERR_PNPM_(?:OUTDATED_LOCKFILE|LOCKFILE_CONFIG_MISMATCH|FROZEN_LOCKFILE|UNSUPPORTED_ENGINE|NO_MATCHING_VERSION|PEER_DEP_ISSUES|NO_PKG_MANIFEST)/i.test(diagnostic);
  const network = !deterministic && /ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENETUNREACH|Could not reach .*timed out|ERR_PNPM_(?:META_FETCH_FAIL|FETCH_5\d\d|FETCH_429)/i.test(diagnostic);
  if (!network || attempt === 2) { process.exitCode = Number(exitCode); break; }
  console.error(`Dependency install network failure; retry ${attempt + 1}/2.`);
  await wait(1000 * (attempt + 1));
}
