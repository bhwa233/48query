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
import { runBatch } from "./run";
import type { CollectorStore, SourceSync } from "./types";
const collect = process.argv.includes("--collect");
const dryRun = process.argv.includes("--dry-run") || process.env.COLLECTOR_DRY_RUN === "1";
const manifestOnly = process.argv.includes("--manifest-only");
const refresh = process.argv.includes("--refresh");
const retryUnverified = process.argv.includes("--retry-unverified");
const since = collectionSince();
if (refresh && !collect) throw new Error("--refresh requires --collect.");
if (collect && manifestOnly) throw new Error("Choose either --collect or --manifest-only.");
const file = process.env.COLLECTOR_GROUP_STATE?.trim();
if (!file) throw new Error("Set COLLECTOR_GROUP_STATE to an explicit local progress JSON path.");
const statePath = resolve(file);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { stopping = true; });
const limit = Number(process.env.COLLECTOR_GROUP_LIMIT ?? 20);
const maxSeconds = Number(process.env.COLLECTOR_GROUP_MAX_SECONDS ?? 0);
if (!Number.isInteger(maxSeconds) || maxSeconds < 0 || maxSeconds > 18000) throw new Error("COLLECTOR_GROUP_MAX_SECONDS must be between 0 and 18000.");
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("COLLECTOR_GROUP_LIMIT must be between 1 and 1000.");
if (collect && !dryRun && (!process.env.INGEST_API_URL || !process.env.INGEST_KEY)) throw new Error("Group writes require INGEST_API_URL and INGEST_KEY.");
await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
const lockPath = `${statePath}.lock`;
// The repo has no local resumable roster runner. Use a single-owner filesystem
// lock and atomic progress rename; D1 source cursors remain the collection truth.
const lock = await open(lockPath, "wx", 0o600);
await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
await lock.close();
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
  }
  applyGroupScope(state, since);
  if (process.argv.includes("--update-roster") && !initialized) {
    const roster = await readGroupRoster(rosterOptions);
    state = { ...state, entries: reconcileGroupEntries(state.entries, roster), officialRows: roster.officialRows, excluded: roster.excluded, rosterRefreshedAt: new Date().toISOString() };
  }
  const save = async () => {
    state.updatedAt = new Date().toISOString();
    await writeFile(`${statePath}.tmp`, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(`${statePath}.tmp`, statePath);
  };
  const summary = () => ({ event: "group_progress", since, scopeComplete: state.entries.filter(e => e.scopeComplete).length, officialRows: state.officialRows, candidates: state.entries.length, excluded: state.excluded.length,
    verified: state.entries.filter(e => e.identity === "verified").length, unverified: state.entries.filter(e => e.identity === "unverified").length,
    failed: state.entries.filter(e => e.identity === "failed").length, pending: state.entries.filter(e => e.identity === "pending").length,
    collected: state.entries.filter(e => e.collectedAt).length, sourceFailures: state.entries.reduce((sum, e) => sum + (e.errorCount ?? 0), 0),
    inspected: state.entries.filter(e => e.inspectedAt).length, inspectionFailures: state.entries.reduce((sum, e) => sum + (e.inspectionErrorCount ?? 0), 0), dryRun,
    processed, budgetReached, stopping, elapsedSeconds: Math.round((Date.now() - started) / 1000) });
  await save();
  if (!manifestOnly) {
    const credential = await loadProductionCredential();
    const token = process.env.POCKET48_TOKEN ?? credential?.token;
    if (!token) throw new Error("Pocket48 credential not found.");
    const dryStore = dryRun ? new DryRunStore() : null;
    const store: CollectorStore | null = collect ? dryStore ?? new HttpIngestStore(process.env.INGEST_API_URL!, process.env.INGEST_KEY!, since) : null;
    const source = new Pocket48Source({ token, since, deviceId: process.env.POCKET48_DEVICE_ID ?? credential?.deviceId,
      pa: process.env.POCKET48_PA, paFactory: process.env.POCKET48_PA ? undefined : createPocket48Pa, apiBaseUrl: process.env.POCKET48_API_BASE_URL,
      memberScope: "all", directoryUrl: process.env.POCKET48_DIRECTORY_URL, historyDirectoryUrl: process.env.POCKET48_HISTORY_DIRECTORY_URL ?? HISTORICAL_DIRECTORY_URL,
      readVerifiedMedia: store?.verifiedRoomMedia?.bind(store), readVerifiedPostImages: store?.verifiedPostImages?.bind(store),
      minIntervalMs: Number(process.env.POCKET48_MIN_INTERVAL_MS ?? 5000), sources: [...COLLECTION_SOURCES] });
    await source.prepareGroupDirectory(state.entries.flatMap(entry => entry.identity === "verified" && entry.member ? [entry.member] : []));
    for (const { entry } of groupWork(state.entries, { collect, refresh, retryUnverified })) {
      if (stopping) break;
      if (processed >= limit || (maxSeconds > 0 && Date.now() - started >= maxSeconds * 1000)) { budgetReached = true; break; }
      processed += 1;
      entry.lastAttemptAt = new Date().toISOString();
      await save();
      try {
        // Recheck a stored identity before writes, also filling this instance's
        // verified author map. A changed account cannot inherit an old checkpoint.
        entry.identity = "pending";
        const member = await source.resolveGroupCandidate(entry.candidate);
        entry.member = member; entry.checkedAt = new Date().toISOString();
        entry.identity = member ? "verified" : "unverified"; delete entry.identityError;
        await save();
        if (member && store) {
          if (dryStore) dryStore.units.length = 0;
          const singleSource = { sources: source.sources, listMembers: async () => [member], listMessages: source.listMessages.bind(source), listContent: source.listContent.bind(source), retryCatalog: source.retryCatalog.bind(source) };
          const localSources = dryRun ? [] : entry.sources ?? [];
          const checkpoints = {
            read: () => localSources,
            write: async (_id: string, sync: SourceSync) => {
              const index = localSources.findIndex(item => item.source === sync.source);
              if (index < 0) localSources.push(sync); else localSources[index] = sync;
              if (!dryRun) { entry.sources = localSources; await save(); }
            },
          };
          const result = await runBatch(singleSource, store, { maxPagesPerMember: Number(process.env.COLLECTOR_MAX_PAGES ?? 1),
            since, checkpoints, maxHistoryPagesPerMember: Number(process.env.COLLECTOR_HISTORY_PAGES ?? 0), catalogRetryLimit: 0 });
          if (dryStore) {
            entry.inspectionSources = localSources; entry.inspectionErrorCount = result.errorCount; entry.inspectedAt = new Date().toISOString(); entry.inspectionScopeComplete = result.scopeComplete;
          } else {
            entry.sources = localSources; entry.scopeComplete = result.scopeComplete;
            entry.errorCount = result.errorCount; entry.collectedAt = new Date().toISOString();
          }
          await save();
        }
      } catch (error) {
        entry.identityError = error instanceof Error ? error.message : "Group member verification interrupted.";
        if (entry.identity !== "verified") entry.identity = "failed";
        await save();
        const cause = error instanceof Error && error.cause && typeof error.cause === "object" ? error.cause as Record<string, unknown> : {};
        if ([401, 403].includes(Number(cause.http)) || [401, 403, 1001, 2001].includes(Number(cause.business))) throw error;
      }
      console.log(JSON.stringify({ event: "group_member_finished", name: entry.candidate.name, memberId: entry.member?.id ?? null, identity: entry.identity,
        collectedAt: entry.collectedAt ?? null, errorCount: entry.errorCount ?? null, inspectedAt: entry.inspectedAt ?? null, inspectionErrorCount: entry.inspectionErrorCount ?? null, dryRun }));
    }
  }
  console.log(JSON.stringify(summary()));
  // Partial coverage and source errors are reported distinctly from success.
  if (!manifestOnly && state.entries.some(e => e.identity !== "verified" || (collect && (dryRun ? !e.inspectedAt || e.inspectionErrorCount || !e.inspectionScopeComplete : !e.collectedAt || e.errorCount || !e.scopeComplete)))) process.exitCode = 1;
} finally {
  await unlink(lockPath);
}
