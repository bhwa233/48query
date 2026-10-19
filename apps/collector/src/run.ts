import type { CollectionSource, CollectorMessage, CollectorSource, CollectorStore, IngestUnit, SourceSync } from "./types";

const emptySync = (source: CollectionSource): SourceSync => ({ source, historyCursor: null, historyDone: false, latestAt: null, latestIds: [], incrementalCursor: null, pendingLatestAt: null, pendingLatestIds: [], status: "pending", lastError: null, lastSuccessAt: null, lastNonemptyAt: null });
const shanghaiDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export async function runBatch(source: CollectorSource, store: CollectorStore, options: { statDate?: string; batchId?: string; maxPagesPerMember?: number; maxMembers?: number; archiveImage?: (image: NonNullable<CollectorMessage["images"]>[number]) => Promise<void> } = {}) {
  const startedAt = new Date().toISOString();
  const statDate = options.statDate ?? shanghaiDate();
  const batchId = options.batchId ?? `batch-${statDate}-${Date.now()}`;
  const maxPages = options.maxPagesPerMember ?? 10;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000) throw new Error("Collector page budget must be between 1 and 1000.");
  const allMembers = await source.listMembers();
  const members = options.maxMembers && options.maxMembers > 0 ? allMembers.slice(0, options.maxMembers) : allMembers;
  if (members.length === 0) throw new Error("No members found for collection.");
  let membersCovered = 0;
  let errorCount = 0;
  let lastError: string | null = null;
  let messagesWritten = 0;
  let imageFailures = 0;
  const streams = source.sources ?? ["room"];

  for (const member of members) {
    const state = await store.getSyncState(member.id);
    let covered = false;
    const unit = (messages: CollectorMessage[], sync?: SourceSync): IngestUnit => ({ batchId, statDate, startedAt, member, messages, recordings: [], messageCursor: state?.messageCursor ?? null, recordingCursor: state?.recordingCursor ?? null, totalMembers: members.length, membersCovered, errorCount, ...(sync ? { sync } : {}) });
    // Register before any source can fail, preserving the original error on completion.
    await store.ingestUnit(unit([]));
    for (const stream of streams) {
      let sync = structuredClone(state?.sources?.find(item => item.source === stream) ?? emptySync(stream));
      try {
        const readPage = (cursor: string | null) => source.listContent ? source.listContent(member, stream, cursor) : source.listMessages(member, cursor);
        const write = async (messages: CollectorMessage[], next: SourceSync) => {
          // Cache/upload progress separately. A gallery outage does not discard text
          // or advance past a missing attachment: its pending row remains retryable.
          for (const message of messages) for (const image of message.images ?? []) {
            const existing = await store.getImage?.(image.id);
            if (existing?.status === "uploaded") Object.assign(image, existing);
            else if (options.archiveImage) {
              await store.saveImage?.(image);
              try { await options.archiveImage(image); }
              catch { image.status = "failed"; imageFailures += 1; }
              await store.saveImage?.(image);
            }
          }
          await store.ingestUnit(unit(messages, next));
          sync = next;
          messagesWritten += messages.length;
          if (messages.some(message => !["event", "excluded", "unknown"].includes(message.kind ?? "text"))) covered = true;
        };
        // Each source has independent newest-page and backfill progress. When a
        // budget expires mid-increment, retain its cursor AND the old boundary.
        const initial = !sync.latestAt;
        let cursor = sync.incrementalCursor;
        for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
          const page = await readPage(cursor);
          const boundary = page.boundary ?? page.items.map(message => ({ id: message.id, occurredAt: message.occurredAt }));
          const observed = page.observed ?? boundary.length;
          const newestAt = boundary.reduce<string | null>((date, item) => !date || item.occurredAt > date ? item.occurredAt : date, sync.pendingLatestAt);
          const newestIds = [...new Set([...(newestAt === sync.pendingLatestAt ? sync.pendingLatestIds : []), ...boundary.filter(item => item.occurredAt === newestAt).map(item => item.id)])];
          if (newestIds.length > 100) throw new Error("Too many messages share a sync boundary; refusing to lose boundary IDs.");
          const reached = Boolean(sync.latestAt && boundary.some(item => item.occurredAt < sync.latestAt!));
          const finished = initial || reached || page.nextCursor === null;
          const now = new Date().toISOString();
          const next: SourceSync = { ...sync, status: page.items.length ? "ok" : "empty", lastError: null, lastSuccessAt: now,
            lastNonemptyAt: page.items.some(item => !["event", "excluded", "unknown"].includes(item.kind ?? "text")) ? now : sync.lastNonemptyAt,
            ...(finished ? { latestAt: newestAt ?? sync.latestAt, latestIds: newestIds.length ? newestIds : sync.latestIds, incrementalCursor: null, pendingLatestAt: null, pendingLatestIds: [] }
              : { incrementalCursor: page.nextCursor, pendingLatestAt: newestAt, pendingLatestIds: newestIds }),
            ...(initial && observed > 0 ? { historyCursor: page.nextCursor, historyDone: page.nextCursor === null } : {}),
          };
          await write(page.items, next);
          if (finished) break;
          cursor = page.nextCursor;
        }
        // Never start a fresh backfill at null after a successful exhaustion.
        if (sync.latestAt && !sync.historyDone && sync.historyCursor !== null) {
          for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
            const page = await readPage(sync.historyCursor);
            const now = new Date().toISOString();
            await write(page.items, { ...sync, historyCursor: page.nextCursor, historyDone: page.nextCursor === null, status: page.items.length ? "ok" : sync.status, lastSuccessAt: now, lastNonemptyAt: page.items.some(item => !["event", "excluded", "unknown"].includes(item.kind ?? "text")) ? now : sync.lastNonemptyAt });
            if (sync.historyDone) break;
          }
        }
        if (stream === "room" && !sync.lastNonemptyAt) throw new Error("No attributable member room messages observed yet; collection is not verified.");
      } catch (error) {
        errorCount += 1;
        lastError = error instanceof Error ? error.message : "Collection failed.";
        sync = { ...sync, status: "failed", lastError: lastError.slice(0, 1000) };
        await store.ingestUnit(unit([], sync));
        console.error(JSON.stringify({ event: "source_failed", memberId: member.id, source: stream, error: lastError }));
      }
    }
    if (covered) membersCovered += 1;
    await store.ingestUnit(unit([]));
  }
  if (imageFailures > 0) { errorCount += imageFailures; lastError = `${imageFailures} image uploads failed; retained for retry.`; }
  await store.completeBatch({ batchId, completedAt: new Date().toISOString(), membersCovered, totalMembers: members.length, errorCount, errorMessage: lastError });
  return { batchId, statDate, totalMembers: members.length, membersCovered, errorCount, messagesWritten, imageFailures };
}
