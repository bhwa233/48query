import { spawnSync } from "node:child_process";
import { verifyBracesPatch } from "./lib/patched-braces.mjs";

// npm audit cannot recognize pnpm source patches. This exception is gated by
// execution of the actual patched transitive dependency, never just a version.
verifyBracesPatch();
const audit = spawnSync("pnpm", ["audit", "--json"], {
  encoding: "utf8",
  timeout: 60000,
  maxBuffer: 8 * 1024 * 1024,
});
if (audit.error) throw audit.error;
const report = JSON.parse(audit.stdout);
if (!report.metadata?.vulnerabilities || report.error)
  throw new Error(`Audit failed: ${audit.stdout}\n${audit.stderr}`);
const advisories = Object.values(report.advisories ?? {});
const remaining = advisories.filter((entry) => {
  const patched =
    entry.github_advisory_id === "GHSA-vfj7-8cjw-p6xm" &&
    entry.module_name === "braces" &&
    entry.findings.every((finding) => finding.version === "3.0.3");
  if (patched)
    console.log(
      `MITIGATED ${entry.github_advisory_id}: braces 3.0.3 depth-limit patch passed runtime regression checks (see docs/dependencies.md).`,
    );
  return !patched;
});
for (const entry of remaining)
  console.error(
    `${entry.severity}: ${entry.module_name}: ${entry.title} (${entry.url})`,
  );
if (remaining.length) process.exitCode = 1;
else console.log("Dependency audit passed: no unhandled advisories.");
