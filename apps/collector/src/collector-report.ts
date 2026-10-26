import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SourceHealth } from "@starter/shared";
import { sourceFreshness, sourceIsFailed } from "./source-health";

// Reuse the existing checkpoints, run/batch metrics and Actions artifact upload.
// This report contains IDs and health metadata, never source content.
export function collectorHealth(entries: { memberId: string; sources: (SourceHealth & { source: string; historyDone?: boolean })[] }[], now = Date.now()) {
  const sources = entries.flatMap(entry => entry.sources.map(sync => ({ memberId: entry.memberId, source: sync.source,
    freshness: sourceFreshness(sync, now), failed: sourceIsFailed(sync), failureCount: sync.failureCount ?? 0,
    failureKind: sync.failureKind ?? null, pendingHistory: Boolean(sync.historyError || sync.historyDone === false),
    paused: sync.paused ?? false, nextRetryAt: sync.nextRetryAt ?? null,
    lastIncrementalSuccessAt: sync.lastIncrementalSuccessAt ?? null, enabledAt: sync.enabledAt ?? null })));
  return { at: new Date(now).toISOString(), totalSources: sources.length,
    failures: sources.filter(row => row.failed || row.freshness === "failed").length,
    freshnessFailures: sources.filter(row => row.freshness === "failed").length,
    unverifiedSources: sources.filter(row => row.freshness === "unverified").length,
    warnings: sources.filter(row => row.freshness === "warning").length,
    isolated: sources.filter(row => row.nextRetryAt).length, paused: sources.filter(row => row.paused).length,
    pendingHistory: sources.filter(row => row.pendingHistory).length, sources };
}

export async function writeCollectorReport(health: ReturnType<typeof collectorHealth>, metrics: Record<string, unknown> = {}) {
  const runErrors = Number(metrics.runErrors ?? metrics.failures ?? metrics.errorCount ?? 0);
  const failed = health.failures > 0 || runErrors > 0
    || Number(metrics.retryFailures ?? 0) > 0 || Number(metrics.rankingErrors ?? 0) > 0;
  const execution = metrics.interrupted === true ? "interrupted" : failed ? "failed" : metrics.rosterStatus === "cached" ? "degraded" : "completed";
  const report = { ...metrics, ...health, sourceFailures: health.failures, runErrors, execution };
  console.log(JSON.stringify({ event: "collector_health", ...report, sources: undefined }));
  const file = process.env.COLLECTOR_REPORT_PATH;
  if (file) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = health.sources.filter(row => row.failed || row.freshness !== "healthy" || row.nextRetryAt)
      .sort((a, b) => Number(b.failed || b.freshness === "failed") - Number(a.failed || a.freshness === "failed")).slice(0, 100);
    const rosterRefreshedAt = typeof metrics.rosterRefreshedAt === "string" ? metrics.rosterRefreshedAt : "unknown";
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n## Collector health\n\nExecution: **${execution}**.\n\n${health.totalSources} sources; ${health.failures} failed (${health.freshnessFailures} overdue); ${health.warnings} stale warnings; ${health.unverifiedSources} awaiting source verification; ${health.isolated} isolated; ${health.paused} paused; ${health.pendingHistory} pending history.\n\n${runErrors} errors reported by work in this run; ${health.failures} unresolved source failures (may overlap); ${Number(metrics.identityPending ?? 0)} identities pending verification.\n\n`
      + (metrics.rosterStatus ? `Roster: **${metrics.rosterStatus === "cached" ? "cached — refresh unavailable" : "fresh"}**; ${Number(metrics.rosterFailures ?? 0)} consecutive refresh failures (capped at 3); last refreshed ${rosterRefreshedAt}; age ${Number(metrics.rosterAgeSeconds ?? 0)} seconds.\n\n` : "")
      + `${Number(metrics.pagesCommitted ?? 0)} committed pages; ${Number(metrics.recoveryProbes ?? 0)} recovery probes.\n\n`
      + `| Member | Source | Freshness | Failure | Next probe |\n| --- | --- | --- | --- | --- |\n`
      + rows.map(row => `| ${row.memberId.replace(/[^a-zA-Z0-9_-]/g, "")} | ${row.source} | ${row.freshness} | ${row.failureKind ?? "none"} (${row.failureCount}) | ${row.nextRetryAt ?? "none"} |`).join("\n") + "\n");
  }
}
