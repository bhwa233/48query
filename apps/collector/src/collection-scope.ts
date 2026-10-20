import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SourceSync } from "./types";
import type { CollectorProgress } from "@starter/shared";

// Reuse runBatch's source checkpoints and atomic JSON persistence used by the
// group runner. A separate scope avoids treating a date boundary as all history.
export const COLLECTION_SINCE = "2025-12-31T16:00:00.000Z";
export function collectionSince(value = process.env.COLLECTOR_SINCE ?? COLLECTION_SINCE) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value)) || Date.parse(value) < Date.parse(COLLECTION_SINCE)) throw new Error("COLLECTOR_SINCE must be an ISO timestamp at or after 2026-01-01T00:00:00+08:00.");
  return new Date(value).toISOString();
}
export type ScopedCheckpoints = {
  read(memberId: string): SourceSync[];
  write(memberId: string, sync: SourceSync): Promise<void>;
};
export async function openScopedCheckpoints(file: string, since: string, remote?: { collectionProgress(): Promise<Map<string, CollectorProgress>>; saveCollectionProgress(progress: CollectorProgress): Promise<void> }): Promise<ScopedCheckpoints> {
  let state: { version: 1; since: string; members: Record<string, SourceSync[]> } = { version: 1, since, members: {} };
  try {
    const previous = JSON.parse(await readFile(file, "utf8")) as typeof state;
    if (previous.version !== 1 || !previous.members || typeof previous.members !== "object") throw new Error("Invalid scoped checkpoint file.");
    if (previous.since === since) state = previous;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const durable = remote ? await remote.collectionProgress() : new Map<string, CollectorProgress>();
  for (const [id, progress] of durable) state.members[id] = progress.sources;
  return {
    read: memberId => structuredClone(state.members[memberId] ?? []),
    write: async (memberId, sync) => {
      const sources = state.members[memberId] ?? [];
      state.members[memberId] = [...sources.filter(item => item.source !== sync.source), sync];
      if (remote) {
        const previous = durable.get(memberId);
        const progress: CollectorProgress = { memberId, since, revision: previous?.revision ?? 0, sources: state.members[memberId],
          lastAttemptAt: new Date().toISOString(), lastIncrementalAt: previous?.lastIncrementalAt ?? null, lastHistoryAt: previous?.lastHistoryAt ?? null,
          collectedAt: previous?.collectedAt ?? null, scopeComplete: false, errorCount: sync.status === "failed" ? 1 : 0 };
        await remote.saveCollectionProgress(progress);
        durable.set(memberId, progress);
      }
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
      await rename(temporary, file);
    },
  };
}
