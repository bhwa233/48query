import { readFile, writeFile, rename, open, unlink, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readGroupRoster, HISTORICAL_DIRECTORY_URL } from "./group-roster";
import { applyGroupScope, groupWork, reconcileGroupEntries, type GroupProgress } from "./group-progress";
import { collectionSince } from "./collection-scope";
import { Pocket48Source, COLLECTION_SOURCES } from "./pocket48-source";
import { loadProductionCredential } from "./credentials";
import { createPocket48Pa } from "./pocket48-auth.mjs";
import { HttpIngestStore } from "./http-store";
import { DryRunStore } from "./dry-run-store";
import { runBatch, emptySync } from "./run";
import { emptyMemberRecheckAt, initializeSourceHealth } from "./source-health";
import { collectorHealth, writeCollectorReport } from "./collector-report";
import type { CollectorStore, SourceSync } from "./types";
import { CollectorStoreError, SourceAuthenticationError, SourceRequestSkipped, SourceVerificationPending } from "./types";
import type { CollectorProgress } from "@starter/shared";
import { CollectionBudget, CollectionStopped } from "./budget";
import { collectMelee } from "./melee";
import { randomUUID } from "node:crypto";
import type { CollectorRun } from "@starter/shared";
const collect = process.argv.includes("--collect");
const dryRun = process.argv.includes("--dry-run") || process.env.COLLECTOR_DRY_RUN === "1";
const manifestOnly = process.argv.includes("--manifest-only");
const refresh = process.argv.includes("--refresh");
const retryUnverified = process.argv.includes("--retry-unverified");
const retrySkipped = process.argv.includes("--retry-skipped");
const since = collectionSince();
if (refresh && !collect) throw new Error("--refresh requires --collect.");
if (collect && manifestOnly) throw new Error("Choose either --collect or --manifest-only.");
const file = process.env.COLLECTOR_GROUP_STATE?.trim();
if (!file) throw new Error("Set COLLECTOR_GROUP_STATE to an explicit local progress JSON path.");
const statePath = resolve(file);
let stopping = false;
const limit = Number(process.env.COLLECTOR_GROUP_LIMIT ?? 20);
const maxSeconds = Number(process.env.COLLECTOR_GROUP_MAX_SECONDS ?? 0);
if (!Number.isInteger(maxSeconds) || maxSeconds < 0 || maxSeconds > 18000) throw new Error("COLLECTOR_GROUP_MAX_SECONDS must be between 0 and 18000.");
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("COLLECTOR_GROUP_LIMIT must be between 1 and 1000.");
if (collect && !dryRun && (!process.env.INGEST_API_URL || !process.env.INGEST_KEY)) throw new Error("Group writes require INGEST_API_URL and INGEST_KEY.");
const budget = new CollectionBudget(maxSeconds ? Date.now() + maxSeconds * 1000 : Infinity);
let activeBudget = budget;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { stopping = true; budget.stop(); });
await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
const lockPath = `${statePath}.lock`;
// The repo has no local resumable roster runner. Use a single-owner filesystem
// lock and atomic progress rename. Scoped D1 progress is authoritative across runners.
const lock = await open(lockPath, "wx", 0o600);
await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
await lock.close();
let monitorRun: CollectorRun | undefined;
let monitorStore: HttpIngestStore | null = null;
let failures = 0;
let runErrors = 0;
const invocationId = process.env.GITHUB_RUN_ID ? `gha-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}` : `run-${randomUUID()}`;
const recovery = { remaining: 10, spentMs: 0, maxMs: 180_000 };
let reportEntries: () => { memberId: string; sources: SourceSync[] }[] = () => [];
let reportSources = [...COLLECTION_SOURCES];
let reportRoster: () => Record<string, unknown> = () => ({});
let reportIdentities: () => Record<string, unknown> = () => ({});
let pagesCommitted = 0;
let messagesWrittenIncludingReplay = 0;
let finished = false;
try {
  const started = Date.now();
  let processed = 0;
  let budgetReached = false;
  let initialized = false;
  let state: GroupProgress;
  const rosterOptions = { directoryUrl: process.env.POCKET48_DIRECTORY_URL, historicalUrl: process.env.POCKET48_HISTORY_DIRECTORY_URL };
  try {
    state = JSON.parse(await readFile(statePath, "utf8")) as GroupProgress;
    if (state.version !== 1 || !Array.isArray(state.entries) || !state.entries.length) throw new Error("Unsupported group progress file.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const roster = await readGroupRoster(rosterOptions);
    const now = new Date().toISOString();
    state = { version: 1, createdAt: now, updatedAt: now, officialRows: roster.officialRows, excluded: roster.excluded,
      entries: roster.candidates.map(candidate => ({ candidate, member: null, identity: "pending" })) };
    initialized = true;
    state.rosterRefreshedAt = now;
  }
  reportEntries = () => state.entries.flatMap(entry => entry.member && entry.identity === "verified"
    ? [{ memberId: entry.member.id, sources: (dryRun ? entry.inspectionSources ?? [] : entry.sources ?? []).filter(sync => reportSources.includes(sync.source)) }] : []);
  reportRoster = () => ({ rosterFailures: state.rosterFailures ?? 0, rosterStatus: state.rosterFailures ? "cached" : "fresh", rosterRefreshedAt: state.rosterRefreshedAt ?? null,
    rosterAgeSeconds: Math.round((Date.now() - Date.parse(state.rosterRefreshedAt ?? state.createdAt)) / 1000) });
  reportIdentities = () => ({ identityPending: state.entries.filter(entry => entry.identity !== "verified").length,
    identityIssues: state.entries.filter(entry => entry.identityError).slice(0, 100).map(entry => ({
      officialIds: entry.candidate.officialIds, candidateIds: entry.candidate.candidateIds, status: entry.identity,
      reason: entry.identityError, checkedAt: entry.checkedAt ?? null,
      nextCheckAt: entry.checkedAt ? new Date(Date.parse(entry.checkedAt) + 7 * 86400_000).toISOString() : null })) });
  // Older runners stored a known identity ambiguity as a hard failure without
  // checkedAt. Preserve that actual attempt as the weekly verification clock.
  for (const entry of state.entries) {
    if (entry.identity === "failed" && entry.identityError?.startsWith("Multiple official Pocket48 identities match this name;")) {
      entry.identity = "unverified";
      entry.checkedAt ??= entry.lastAttemptAt;
    }
  }
  applyGroupScope(state, since);
  if (process.argv.includes("--update-roster") && !initialized) {
    try {
      const roster = await readGroupRoster(rosterOptions);
      state = { ...state, entries: reconcileGroupEntries(state.entries, roster), officialRows: roster.officialRows, excluded: roster.excluded, rosterRefreshedAt: new Date().toISOString() };
      state.rosterFailures = 0;
    } catch (error) {
      if (!(error instanceof SourceRequestSkipped)) throw error;
      // Reuse the restored roster and checkpoints only for this transient read;
      // keep rosterRefreshedAt unchanged so a skipped refresh is not a success.
      console.log(JSON.stringify({ event: "group_roster_skipped", message: error.message, candidates: state.entries.length, rosterRefreshedAt: state.rosterRefreshedAt ?? null }));
      state.rosterFailures = Math.min(3, (state.rosterFailures ?? 0) + 1);
      // A usable cached roster lets existing sources keep collecting. Report
      // degraded roster coverage separately from failed collection work; never
      // advance its freshness timestamp or certify newly discovered members.
    }
  }
  const save = async () => {
    state.updatedAt = new Date().toISOString();
    await writeFile(`${statePath}.tmp`, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(`${statePath}.tmp`, statePath);
  };
  const summary = () => ({ event: "group_progress", since, scopeComplete: state.entries.filter(e => e.scopeComplete).length, officialRows: state.officialRows, candidates: state.entries.length, excluded: state.excluded.length,
    emptyMembersDeferred: state.entries.filter(e => e.identity === "verified" && e.scopeComplete && (emptyMemberRecheckAt(e.sources ?? [], reportSources) ?? 0) > Date.now()).length,
    verified: state.entries.filter(e => e.identity === "verified").length, unverified: state.entries.filter(e => e.identity === "unverified").length,
    failed: state.entries.filter(e => e.identity === "failed").length, pending: state.entries.filter(e => e.identity === "pending").length,
    collected: state.entries.filter(e => e.collectedAt).length, sourceFailures: state.entries.reduce((sum, e) => sum + (e.errorCount ?? 0), 0),
    sourcesSkipped: state.entries.reduce((sum, e) => sum + (e.sources?.filter(source => source.skippedAt).length ?? 0), 0),
    inspected: state.entries.filter(e => e.inspectedAt).length, inspectionFailures: state.entries.reduce((sum, e) => sum + (e.inspectionErrorCount ?? 0), 0), dryRun,
    processed, budgetReached, stopping, outcome: failures > 0 ? "failed" : budgetReached || stopping || state.entries.some(e => dryRun ? !e.inspectionScopeComplete : !e.scopeComplete) ? "pending" : "complete", elapsedSeconds: Math.round((Date.now() - started) / 1000) });
  await save();
  if (!manifestOnly) {
    const credential = await loadProductionCredential();
    const token = process.env.POCKET48_TOKEN ?? credential?.token;
    if (!token) throw new Error("Pocket48 credential not found.");
    const dryStore = dryRun ? new DryRunStore() : null;
    const store: CollectorStore | null = collect ? dryStore ?? new HttpIngestStore(process.env.INGEST_API_URL!, process.env.INGEST_KEY!, since) : null;
    const remoteStore = store instanceof HttpIngestStore ? store : null;
    if (remoteStore) {
      monitorStore = remoteStore;
      const startedAt = new Date(started).toISOString();
      monitorRun = { id: invocationId,
        statDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(started)),
        startedAt, completedAt: null, status: "running", totalMembers: state.entries.length, errorCount: 0 };
      await remoteStore.saveRun(monitorRun);
    }
    const durable = remoteStore ? await remoteStore.collectionProgress() : new Map<string, CollectorProgress>();
    const restore = (entry: typeof state.entries[number], progress: CollectorProgress) => {
      entry.sources = structuredClone(progress.sources).map(sync => initializeSourceHealth({ ...sync,
        enabledAt: sync.enabledAt ?? entry.sources?.find(previous => previous.source === sync.source)?.enabledAt }));
      entry.lastAttemptAt = progress.lastAttemptAt ?? undefined;
      entry.lastIncrementalAt = progress.lastIncrementalAt ?? undefined;
      entry.lastHistoryAt = progress.lastHistoryAt ?? undefined;
      entry.collectedAt = progress.collectedAt ?? undefined;
      entry.errorCount = progress.errorCount;
      entry.scopeComplete = progress.scopeComplete;
    };
    for (const entry of state.entries) {
      const id = entry.member?.id;
      if (id && durable.has(id)) restore(entry, durable.get(id)!);
    }
    const persist = async (entry: typeof state.entries[number]) => {
      if (remoteStore && entry.member) {
        const progress: CollectorProgress = { memberId: entry.member.id, since, revision: durable.get(entry.member.id)?.revision ?? 0,
          sources: entry.sources ?? [], lastAttemptAt: entry.lastAttemptAt ?? null,
          lastIncrementalAt: entry.lastIncrementalAt ?? null, lastHistoryAt: entry.lastHistoryAt ?? null,
          collectedAt: entry.collectedAt ?? null, scopeComplete: entry.scopeComplete ?? false, errorCount: entry.errorCount ?? 0 };
        await remoteStore.saveCollectionProgress(progress);
        durable.set(progress.memberId, progress);
      }
      await save();
    };
    const sources = (process.env.COLLECTOR_SOURCES?.split(",").filter(Boolean) ?? [...COLLECTION_SOURCES]).map(value => {
      if (!COLLECTION_SOURCES.includes(value as typeof COLLECTION_SOURCES[number])) throw new Error(`Unsupported source: ${value}`);
      return value as typeof COLLECTION_SOURCES[number];
    });
    reportSources = sources;
    for (const entry of state.entries) {
      if (entry.identity !== "verified" || !entry.member || dryRun) continue;
      entry.sources = [...(entry.sources ?? []).filter(sync => !sources.includes(sync.source)),
        ...sources.map(stream => initializeSourceHealth(entry.sources?.find(sync => sync.source === stream) ?? emptySync(stream)))];
    }
    await save();
    const source = new Pocket48Source({ token, since, deviceId: process.env.POCKET48_DEVICE_ID ?? credential?.deviceId,
      pa: process.env.POCKET48_PA, paFactory: process.env.POCKET48_PA ? undefined : createPocket48Pa, apiBaseUrl: process.env.POCKET48_API_BASE_URL,
      memberScope: "all", directoryUrl: process.env.POCKET48_DIRECTORY_URL, historyDirectoryUrl: process.env.POCKET48_HISTORY_DIRECTORY_URL ?? HISTORICAL_DIRECTORY_URL,
      readVerifiedMedia: store?.verifiedRoomMedia?.bind(store), readVerifiedPostImages: store?.verifiedPostImages?.bind(store),
      budget: () => activeBudget, maxOriginalLookups: 12,
      minIntervalMs: Number(process.env.POCKET48_MIN_INTERVAL_MS ?? 5000), sources });
    try { await source.prepareGroupDirectory(state.entries.flatMap(entry => entry.identity === "verified" && entry.member ? [entry.member] : [])); }
    catch (error) { if (!budget.stopped) throw error; }
    // A reserved allowance inside runBatch cannot reach members at the back of
    // the normal queue. Drain due probes first, using the existing global cap.
    for (const phase of ["recovery", "incremental", "history"] as const) {
      if (phase === "incremental" && collect) {
        activeBudget = budget.slice(180);
        const melee = await collectMelee(source, remoteStore, activeBudget);
        failures += melee.errors;
      }
      const phaseBudget = phase === "recovery" ? budget.slice(recovery.maxMs / 1000)
        : phase === "incremental" && maxSeconds ? budget.slice(Math.max(0, (budget.deadline - Date.now()) / 1000) * 0.75) : budget;
      let phaseProcessed = 0;
      for (const { entry } of groupWork(state.entries, { collect, refresh,
        retryUnverified, recheckDue: process.env.COLLECTOR_GROUP_WEEKLY_RECHECK === "1", retrySkipped, phase, sources })) {
        if (phase === "recovery" && (recovery.remaining <= 0 || recovery.spentMs >= recovery.maxMs)) break;
        if (phaseBudget.stopped || phaseProcessed >= limit) { budgetReached = true; break; }
        phaseProcessed += 1; processed += 1;
        activeBudget = phaseBudget.slice(300);
        const attemptedAt = new Date().toISOString();
        entry.lastAttemptAt = attemptedAt;
        if (phase === "incremental") entry.lastIncrementalAt = attemptedAt;
        else if (phase === "history") entry.lastHistoryAt = attemptedAt;
        await persist(entry);
        console.log(JSON.stringify({ event: "group_member_started", phase, memberId: entry.member?.id ?? null, name: entry.candidate.name, elapsedSeconds: Math.round((Date.now() - started) / 1000) }));
        const previousIdentity = entry.identity;
        try {
          const previousMemberId = entry.member?.id;
          entry.identity = "pending";
          // Roster reconciliation already resets changed identities to pending.
          // Reuse verified identities; followers and actual source authors are
          // still checked, without spending two profile reads on every phase.
          const member = previousIdentity === "verified" && entry.member ? entry.member : await source.resolveGroupCandidate(entry.candidate);
          entry.member = member; entry.checkedAt = new Date().toISOString();
          entry.identity = member ? "verified" : "unverified"; delete entry.identityError;
          if (member?.id !== previousMemberId || !member) {
            delete entry.sources; delete entry.collectedAt; delete entry.lastHistoryAt;
            entry.scopeComplete = false; entry.errorCount = 0;
          }
          if (member && store) {
            const previous = durable.get(member.id);
            if (previous) restore(entry, previous);
            entry.lastAttemptAt = attemptedAt;
            if (phase === "incremental") entry.lastIncrementalAt = attemptedAt;
            else if (phase === "history") entry.lastHistoryAt = attemptedAt;
            await persist(entry);
            if (dryStore) dryStore.units.length = 0;
            const singleSource = { sources: source.sources, listMembers: async () => [member], readFollowers: phase === "incremental" ? source.readFollowers.bind(source) : undefined, listMessages: source.listMessages.bind(source), listContent: source.listContent.bind(source), retryCatalog: source.retryCatalog.bind(source) };
            const localSources = dryRun ? [] : entry.sources ?? [];
            const checkpoints = {
              read: () => localSources,
              write: async (_id: string, sync: SourceSync) => {
                const index = localSources.findIndex(item => item.source === sync.source);
                if (index < 0) localSources.push(sync); else localSources[index] = sync;
                if (!dryRun) { entry.sources = localSources; await persist(entry); }
              },
            };
            const result = await runBatch(singleSource, store, { maxPagesPerMember: phase === "recovery" ? 1 : Number(process.env.COLLECTOR_MAX_PAGES ?? 1),
              runId: invocationId, recovery, recoveryOnly: phase === "recovery", phase: phase === "history" ? "history" : "incremental", batchId: monitorRun ? `${monitorRun.id}:${phase}:${member.id}` : undefined,
              since, checkpoints, budget: activeBudget, historyOnly: phase === "history", retrySkipped,
              maxHistoryPagesPerMember: phase === "history" ? Number(process.env.COLLECTOR_HISTORY_PAGES ?? 1) : 0,
              catalogRetryLimit: phase === "history" ? 2 : 0 });
            failures += result.errorCount;
            pagesCommitted += result.pagesCommitted;
            messagesWrittenIncludingReplay += result.messagesWritten;
            if (dryStore) {
              entry.inspectionSources = localSources; entry.inspectionErrorCount = result.errorCount; entry.inspectedAt = new Date().toISOString(); entry.inspectionScopeComplete = result.scopeComplete;
            } else {
              entry.sources = localSources;
              if (phase !== "recovery") {
                entry.scopeComplete = result.scopeComplete;
                entry.errorCount = result.errorCount; entry.collectedAt = new Date().toISOString();
              }
            }
            budgetReached ||= result.budgetReached;
          }
        } catch (error) {
          if (error instanceof CollectionStopped || activeBudget.stopped) { budgetReached = true; }
          else if (error instanceof SourceRequestSkipped) {
            entry.identity = previousIdentity;
            entry.identityError = error.message;
            console.log(JSON.stringify({ event: "group_member_skipped", memberId: entry.member?.id ?? null, phase, error: error.message }));
          }
          else if (error instanceof SourceVerificationPending) {
            entry.identity = "unverified";
            entry.checkedAt = new Date().toISOString();
            entry.identityError = error.message;
            console.log(JSON.stringify({ event: "group_identity_pending", officialIds: entry.candidate.officialIds,
              candidateIds: entry.candidate.candidateIds, phase, error: error.message, checkedAt: entry.checkedAt }));
          }
          else {
            failures += 1;
            entry.identityError = error instanceof Error ? error.message : "Group member verification interrupted.";
            console.error(JSON.stringify({ event: "group_member_interrupted", memberId: entry.member?.id ?? null, phase, error: entry.identityError }));
            if (entry.identity !== "verified") entry.identity = "failed";
            if (error instanceof CollectorStoreError || error instanceof SourceAuthenticationError) throw error;
            const cause = error instanceof Error && error.cause && typeof error.cause === "object" ? error.cause as Record<string, unknown> : {};
            if ([401, 403].includes(Number(cause.http)) || [401, 403, 1001, 2001].includes(Number(cause.business))) throw error;
          }
        }
        await persist(entry);
        console.log(JSON.stringify({ event: "group_member_finished", phase, name: entry.candidate.name, memberId: entry.member?.id ?? null,
          identity: entry.identity, errorCount: entry.errorCount ?? 0, scopeComplete: entry.scopeComplete ?? false, budgetReached: activeBudget.stopped, dryRun }));
      }
    }
  }
  runErrors = failures;
  failures = Math.max(failures, collectorHealth(reportEntries()).failures);
  console.log(JSON.stringify(summary()));
  if (monitorRun) {
    monitorRun.status = failures > 0 ? "failed" : budgetReached || stopping ? "bounded" : "completed";
    monitorRun.errorCount = failures;
  }
  // A bounded batch can succeed with remaining work; actual request/write errors fail.
  if (!manifestOnly && failures > 0) process.exitCode = 1;
  finished = true;
} finally {
  try {
    const health = collectorHealth(reportEntries());
    try { await writeCollectorReport(health, { runId: invocationId, dryRun, runErrors: finished ? runErrors : failures,
      interrupted: !finished, ...reportRoster(), ...reportIdentities(), pagesCommitted, messagesWrittenIncludingReplay, recoveryProbes: 10 - recovery.remaining }); }
    catch {
      failures += 1;
      process.exitCode = 1;
      if (monitorRun) monitorRun.status = "failed";
      console.error(JSON.stringify({ event: "collector_report_failed" }));
    }
    if (monitorRun && monitorStore) await monitorStore.saveRun({ ...monitorRun, completedAt: new Date().toISOString(),
      status: monitorRun.status === "running" ? "failed" : monitorRun.status,
      errorCount: monitorRun.status === "running" ? Math.max(1, failures) : failures });
  } finally { await unlink(lockPath); }
}
