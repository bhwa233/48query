import { readFile, writeFile, rename, open, unlink, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildGroupRoster, COMMUNITY_DIRECTORY_URL, OFFICIAL_ROSTER_URL, type RosterCandidate } from "./group-roster";
import { Pocket48Source, COLLECTION_SOURCES } from "./pocket48-source";
import { loadProductionCredential } from "./credentials";
import { createPocket48Pa } from "./pocket48-auth.mjs";
import { HttpIngestStore } from "./http-store";
import { runBatch } from "./run";
import type { CollectorMember, SourceSync } from "./types";

type Entry = { candidate: RosterCandidate; member: CollectorMember | null; identity: "pending" | "verified" | "unverified" | "failed"; identityError?: string; checkedAt?: string; collectedAt?: string; errorCount?: number; sources?: SourceSync[] };
type Progress = { version: 1; createdAt: string; updatedAt: string; officialRows: number; excluded: { id: string; name: string }[]; entries: Entry[] };
const collect = process.argv.includes("--collect");
const manifestOnly = process.argv.includes("--manifest-only");
if (collect && manifestOnly) throw new Error("Choose either --collect or --manifest-only.");
const file = process.env.COLLECTOR_GROUP_STATE?.trim();
if (!file) throw new Error("Set COLLECTOR_GROUP_STATE to an explicit local progress JSON path.");
const statePath = resolve(file);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { stopping = true; });
const limit = Number(process.env.COLLECTOR_GROUP_LIMIT ?? 20);
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("COLLECTOR_GROUP_LIMIT must be between 1 and 1000.");
if (collect && (!process.env.INGEST_API_URL || !process.env.INGEST_KEY)) throw new Error("Group writes require INGEST_API_URL and INGEST_KEY.");
await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
const lockPath = `${statePath}.lock`;
// The repo has no local resumable roster runner. Use a single-owner filesystem
// lock and atomic progress rename; D1 source cursors remain the collection truth.
const lock = await open(lockPath, "wx", 0o600);
await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
await lock.close();
try {
  let state: Progress;
  try {
    state = JSON.parse(await readFile(statePath, "utf8")) as Progress;
    if (state.version !== 1 || !Array.isArray(state.entries) || !state.entries.length) throw new Error("Unsupported group progress file.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const read = async (url: string): Promise<unknown> => {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Roster request failed (HTTP ${response.status}).`);
      return response.json() as Promise<unknown>;
    };
    const [official, community] = await Promise.all([read(OFFICIAL_ROSTER_URL), read(process.env.POCKET48_DIRECTORY_URL ?? COMMUNITY_DIRECTORY_URL)]);
    const roster = buildGroupRoster(official, community);
    const now = new Date().toISOString();
    state = { version: 1, createdAt: now, updatedAt: now, officialRows: roster.officialRows, excluded: roster.excluded,
      entries: roster.candidates.map(candidate => ({ candidate, member: null, identity: "pending" })) };
  }
  const save = async () => {
    state.updatedAt = new Date().toISOString();
    await writeFile(`${statePath}.tmp`, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(`${statePath}.tmp`, statePath);
  };
  const summary = () => ({ event: "group_progress", officialRows: state.officialRows, candidates: state.entries.length, excluded: state.excluded.length,
    verified: state.entries.filter(e => e.identity === "verified").length, unverified: state.entries.filter(e => e.identity === "unverified").length,
    failed: state.entries.filter(e => e.identity === "failed").length, pending: state.entries.filter(e => e.identity === "pending").length,
    collected: state.entries.filter(e => e.collectedAt).length, sourceFailures: state.entries.reduce((sum, e) => sum + (e.errorCount ?? 0), 0) });
  await save();
  if (!manifestOnly) {
    const credential = await loadProductionCredential();
    const token = process.env.POCKET48_TOKEN ?? credential?.token;
    if (!token) throw new Error("Pocket48 credential not found.");
    const source = new Pocket48Source({ token, deviceId: process.env.POCKET48_DEVICE_ID ?? credential?.deviceId, paFactory: createPocket48Pa,
      memberScope: "all", directoryUrl: process.env.POCKET48_DIRECTORY_URL, minIntervalMs: Number(process.env.POCKET48_MIN_INTERVAL_MS ?? 5000), sources: [...COLLECTION_SOURCES] });
    await source.prepareGroupDirectory(state.entries.flatMap(entry => entry.identity === "verified" && entry.member ? [entry.member] : []));
    const store = collect ? new HttpIngestStore(process.env.INGEST_API_URL!, process.env.INGEST_KEY!) : null;
    let processed = 0;
    for (const entry of state.entries) {
      if (stopping) break;
      const retry = process.argv.includes("--retry-unverified");
      const needsIdentity = entry.identity === "pending" || (retry && entry.identity !== "verified");
      if (!needsIdentity && !(collect && entry.identity === "verified" && !entry.collectedAt)) continue;
      if (processed++ >= limit) break;
      try {
        // Recheck a stored identity before writes, also filling this instance's
        // verified author map. A changed account cannot inherit an old checkpoint.
        entry.identity = "pending";
        const member = await source.resolveGroupCandidate(entry.candidate);
        entry.member = member; entry.checkedAt = new Date().toISOString();
        entry.identity = member ? "verified" : "unverified"; delete entry.identityError;
        await save();
        if (member && store) {
          const singleSource = { sources: source.sources, listMembers: async () => [member], listMessages: source.listMessages.bind(source), listContent: source.listContent.bind(source), retryCatalog: source.retryCatalog.bind(source) };
          const result = await runBatch(singleSource, store, { maxPagesPerMember: Number(process.env.COLLECTOR_MAX_PAGES ?? 1),
            maxHistoryPagesPerMember: Number(process.env.COLLECTOR_HISTORY_PAGES ?? 0), catalogRetryLimit: 0 });
          entry.sources = (await store.getSyncState(member.id))?.sources;
          entry.errorCount = result.errorCount; entry.collectedAt = new Date().toISOString();
          await save();
        }
      } catch (error) {
        entry.identityError = error instanceof Error ? error.message : "Group member verification interrupted.";
        if (entry.identity !== "verified") entry.identity = "failed";
        await save();
        const cause = error instanceof Error && error.cause && typeof error.cause === "object" ? error.cause as Record<string, unknown> : {};
        if ([401, 403].includes(Number(cause.http)) || [401, 403, 1001, 2001].includes(Number(cause.business))) throw error;
      }
      console.log(JSON.stringify({ event: "group_member_finished", name: entry.candidate.name, memberId: entry.member?.id ?? null, identity: entry.identity, collectedAt: entry.collectedAt ?? null, errorCount: entry.errorCount ?? null }));
    }
  }
  console.log(JSON.stringify(summary()));
  // Partial coverage and source errors are reported distinctly from success.
  if (!manifestOnly && state.entries.some(e => e.identity !== "verified" || (collect && (!e.collectedAt || e.errorCount)))) process.exitCode = 1;
} finally {
  await unlink(lockPath);
}
