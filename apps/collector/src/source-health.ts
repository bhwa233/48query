import type { SourceHealth } from "@starter/shared";
import { SourceRequestSkipped, SourceVerificationPending } from "./types";

// Extend the existing SourceSync JSON and CollectionBudget rather than adding a
// queue/scheduler dependency: these transitions are specific to collector pages.
const hours = [2, 6, 12, 24] as const;
export type RecoveryAllowance = { remaining: number; spentMs: number; maxMs: number };

export function initializeSourceHealth<T extends SourceHealth>(sync: T, now = Date.now()): T {
  if (sync.healthVersion === 1) return sync;
  const next = { ...sync, healthVersion: 1 as const, enabledAt: sync.enabledAt ?? new Date(now).toISOString() };
  // Only migrate recognizable automatic suspensions. Unknown legacy reasons
  // remain paused for inspection; never infer permission to resume a manual stop.
  if (/unverified|verif(?:ied|ication)|no readable room|attributable|catalog discovery/i.test(sync.lastError ?? "")) {
    return { ...next, skippedAt: null, failureCount: 0, historyError: sync.lastError, historyRetryAt: new Date(now).toISOString() };
  }
  if (!sync.skippedAt) return next;
  if (/Pocket48|fetch failed|Upstream/i.test(sync.lastError ?? "")) {
    return { ...next, failureKind: /HTTP (?:429|5\d\d)|fetch failed/i.test(sync.lastError ?? "") ? "transient" : "protocol",
      nextRetryAt: new Date(now).toISOString(), recoveryAttempt: 0 };
  }
  return { ...next, paused: true };
}

export function recordSourceIssue<T extends SourceHealth>(sync: T, error: unknown, runId: string, now = Date.now()): T {
  const reason = (error instanceof Error ? error.message : "Collection failed.").slice(0, 1000);
  const at = new Date(now).toISOString();
  if (error instanceof SourceVerificationPending && !(error instanceof SourceRequestSkipped)) {
    return { ...sync, status: "pending", historyError: reason, historyRetryAt: new Date(now + 2 * 3600_000).toISOString() };
  }
  const kind = error instanceof SourceRequestSkipped ? "transient" : "protocol";
  const count = Math.min(3, (sync.failureCount ?? 0) + (sync.lastFailureRunId === runId ? 0 : 1));
  const isolate = kind === "protocol" || count >= 3;
  const attempt = isolate ? Math.min(4, (sync.recoveryAttempt ?? 0) + (sync.skippedAt && sync.lastFailureRunId !== runId ? 1 : 0)) : 0;
  return { ...sync, status: kind === "transient" && count < 3 ? "pending" : "failed", lastError: reason,
    failureKind: kind, failureCount: count, lastFailureRunId: runId, lastFailureAt: at,
    skippedAt: isolate ? sync.skippedAt ?? at : null, recoveryAttempt: attempt,
    nextRetryAt: isolate ? new Date(now + hours[Math.min(attempt, 3)]! * 3600_000).toISOString() : null };
}

export function sourceIsFailed(sync: SourceHealth): boolean {
  return !sync.paused && (sync.failureKind === "protocol" || sync.failureKind === "transient" && (sync.failureCount ?? 0) >= 3);
}

export function sourceFreshness(sync: SourceHealth, now = Date.now()): "healthy" | "warning" | "failed" | "paused" {
  if (sync.paused) return "paused";
  const at = sync.lastIncrementalSuccessAt ?? sync.enabledAt;
  const elapsed = at ? now - Date.parse(at) : 0;
  return elapsed >= 48 * 3600_000 ? "failed" : elapsed >= 24 * 3600_000 ? "warning" : "healthy";
}

export function sourceRecovered<T extends SourceHealth>(sync: T, incremental: boolean, now = Date.now()): T {
  return { ...sync, failureKind: null, failureCount: 0, skippedAt: null, nextRetryAt: null, recoveryAttempt: 0, lastError: null,
    ...(incremental ? { lastIncrementalSuccessAt: new Date(now).toISOString() } : {}) };
}
