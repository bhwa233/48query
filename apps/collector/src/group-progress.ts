import type { buildGroupRoster, RosterCandidate } from "./group-roster";
import type { CollectorMember, SourceSync } from "./types";

export type GroupEntry = {
  candidate: RosterCandidate;
  member: CollectorMember | null;
  identity: "pending" | "verified" | "unverified" | "failed";
  identityError?: string;
  checkedAt?: string;
  lastAttemptAt?: string;
  lastIncrementalAt?: string;
  lastHistoryAt?: string;
  collectedAt?: string;
  errorCount?: number;
  sources?: SourceSync[];
  inspectedAt?: string;
  inspectionErrorCount?: number;
  inspectionSources?: SourceSync[];
  scopeComplete?: boolean;
  inspectionScopeComplete?: boolean;
};
export type GroupProgress = { version: 1; since?: string; createdAt: string; updatedAt: string; rosterRefreshedAt?: string; officialRows: number; excluded: { id: string; name: string }[]; entries: GroupEntry[] };

export function applyGroupScope(state: GroupProgress, since: string) {
  if (state.since === since) return;
  state.since = since;
  for (const entry of state.entries) {
    delete entry.collectedAt; delete entry.sources; delete entry.errorCount; delete entry.lastAttemptAt;
    delete entry.inspectedAt; delete entry.inspectionSources; delete entry.inspectionErrorCount;
    delete entry.scopeComplete; delete entry.inspectionScopeComplete;
    delete entry.lastIncrementalAt; delete entry.lastHistoryAt;
  }
}

export function reconcileGroupEntries(previous: GroupEntry[], roster: ReturnType<typeof buildGroupRoster>): GroupEntry[] {
  const used = new Set<GroupEntry>();
  const entries = roster.candidates.map(candidate => {
    const old = previous.find(entry => !used.has(entry) && (candidate.officialIds.length && entry.candidate.officialIds.length
      ? candidate.officialIds.some(id => entry.candidate.officialIds.includes(id))
      : candidate.name === entry.candidate.name && (candidate.candidateIds.length
        ? candidate.candidateIds.some(id => entry.candidate.candidateIds.includes(id))
        : !entry.candidate.candidateIds.length)));
    if (!old) return { candidate, member: null, identity: "pending" as const };
    used.add(old);
    const addedIdentity = candidate.candidateIds.some(id => !old.candidate.candidateIds.includes(id));
    if (addedIdentity && old.identity !== "verified" || old.identity === "verified" && (!old.member || !candidate.candidateIds.includes(old.member.id))) {
      return { ...old, candidate, identity: "pending" as const, identityError: undefined, lastAttemptAt: undefined };
    }
    return { ...old, candidate, ...(candidate.ambiguousName ? { identity: "unverified" as const } : {}) };
  });
  // Disappearing from today's website is not evidence of non-membership. Keep
  // previously discovered graduates, together with their original checkpoints.
  return [...entries, ...previous.filter(entry => !used.has(entry))];
}

// The existing source cursors resume pages; they do not choose which member
// runs next. Rotate this persisted group queue by attempts, including failures,
// so a bounded recurring run cannot keep retrying only its first members.
export function groupWork(entries: GroupEntry[], options: { collect: boolean; refresh: boolean; retryUnverified: boolean; phase?: "incremental" | "history" }) {
  return entries.map((entry, index) => {
    const identity = entry.identity === "pending" || (options.retryUnverified && entry.identity !== "verified");
    const collect = options.collect && entry.identity === "verified" && (options.refresh || !entry.collectedAt || entry.scopeComplete === false);
    return { entry, index, identity, collect };
  }).filter(item => options.phase === "history" ? options.collect && item.entry.identity === "verified" && item.entry.scopeComplete !== true && Boolean(item.entry.sources?.length) : item.identity || item.collect).sort((a, b) => {
    if (options.phase) {
      const key = options.phase === "history" ? "lastHistoryAt" : "lastIncrementalAt";
      return (a.entry[key] ?? "").localeCompare(b.entry[key] ?? "") || a.index - b.index;
    }
    const first = Number(Boolean(a.entry.collectedAt)) - Number(Boolean(b.entry.collectedAt));
    return first || (a.entry.lastAttemptAt ?? "").localeCompare(b.entry.lastAttemptAt ?? "") || a.index - b.index;
  });
}
