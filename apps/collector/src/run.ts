import type { CatalogEntry } from "@starter/shared";
import type { CollectionSource, CollectorMessage, CollectorSource, CollectorStore, IngestUnit, SourceSync } from "./types";

const emptySync = (source: CollectionSource): SourceSync => ({ source, historyCursor: null, historyDone: false, latestAt: null, latestIds: [], incrementalCursor: null, pendingLatestAt: null, pendingLatestIds: [], status: "pending", lastError: null, lastSuccessAt: null, lastNonemptyAt: null });
const shanghaiDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export async function runBatch(source: CollectorSource, store: CollectorStore, options: { statDate?: string; batchId?: string; maxPagesPerMember?: number; maxHistoryPagesPerMember?: number; maxMembers?: number; historyOnly?: boolean; catalogRetryLimit?: number; archiveImage?: (image: NonNullable<CollectorMessage["images"]>[number]) => Promise<void>; archiveVideo?: (video: NonNullable<CollectorMessage["videos"]>[number]) => Promise<void> } = {}) {
  const startedAt = new Date().toISOString();
  const statDate = options.statDate ?? shanghaiDate();
  const batchId = options.batchId ?? `batch-${statDate}-${Date.now()}`;
  const maxPages = options.maxPagesPerMember ?? 10;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000) throw new Error("Collector page budget must be between 1 and 1000.");
  const historyPages = options.maxHistoryPagesPerMember ?? maxPages;
  if (!Number.isInteger(historyPages) || historyPages < 0 || historyPages > 1000) throw new Error("Collector history budget must be between 0 and 1000.");
  const catalogRetryLimit = options.catalogRetryLimit ?? 10;
  if (!Number.isInteger(catalogRetryLimit) || catalogRetryLimit < 0 || catalogRetryLimit > 50) throw new Error("Catalog retry limit must be between 0 and 50.");
  const allMembers = await source.listMembers();
  const members = options.maxMembers && options.maxMembers > 0 ? allMembers.slice(0, options.maxMembers) : allMembers;
  if (members.length === 0) throw new Error("No members found for collection.");
  let membersCovered = 0;
  let errorCount = 0;
  let lastError: string | null = null;
  let messagesWritten = 0;
  let imageFailures = 0;
  let videoFailures = 0;
  const streams = source.sources ?? ["room"];

  for (const member of members) {
    const state = await store.getSyncState(member.id);
    let covered = false;
    let roomSync: SourceSync | undefined;
    let verifiedRoomContent = false;
    const unit = (messages: CollectorMessage[], sync?: SourceSync, catalog?: CatalogEntry[]): IngestUnit => ({ catalog, batchId, statDate, startedAt, member, messages, recordings: [], messageCursor: state?.messageCursor ?? null, recordingCursor: state?.recordingCursor ?? null, totalMembers: members.length, membersCovered, errorCount, ...(sync ? { sync } : {}) });
    // Register before any source can fail, preserving the original error on completion.
    await store.ingestUnit(unit([]));
    for (const stream of streams) {
      let sync = structuredClone(state?.sources?.find(item => item.source === stream) ?? emptySync(stream));
      try {
        const readPage = (cursor: string | null) => source.listContent ? source.listContent(member, stream, cursor) : source.listMessages(member, cursor);
        const write = async (messages: CollectorMessage[], next: SourceSync, catalog?: CatalogEntry[]) => {
          // Persist attributable content before slow external uploads. Leave the
          // checkpoint unchanged until all upload results have been recorded, so
          // interruption can safely replay the page without losing its text.
          if (messages.some(message => message.images?.length || message.videos?.length)) await store.ingestUnit(unit(messages, undefined, catalog));
          // Cache/upload progress separately. A gallery outage does not discard text
          // or advance past a missing attachment: its pending row remains retryable.
          const attachments = messages.flatMap(message => message.images ?? []);
          const uniqueImages = new Map(attachments.map(image => [image.id, image]));
          const uploads = [...uniqueImages.values()];
          // Keep uploads bounded so one multi-image page can finish within a
          // daily job; checkpoints are committed only after all results.
          for (let offset = 0; offset < uploads.length; offset += 3) {
            await Promise.all(uploads.slice(offset, offset + 3).map(async image => {
              const existing = await store.getImage?.(image.id);
              if (existing?.status === "uploaded") Object.assign(image, existing);
              else if (options.archiveImage) {
                await store.saveImage?.(image);
                try { await options.archiveImage(image); }
                catch { image.status = "failed"; imageFailures += 1; }
                await store.saveImage?.(image);
              }
            }));
          }
          for (const image of attachments) Object.assign(image, uniqueImages.get(image.id));
          const videos = messages.flatMap(message => message.videos ?? []);
          const uniqueVideos = new Map(videos.map(video => [video.id, video]));
          for (const video of uniqueVideos.values()) {
            const existing = await store.getVideo?.(video.id);
            if (existing?.status === "uploaded" || existing?.status === "skipped") Object.assign(video, existing);
            else if (options.archiveVideo) {
              await store.saveVideo?.(video);
              try { await options.archiveVideo(video); }
              catch { video.status = "failed"; videoFailures += 1; }
              await store.saveVideo?.(video);
            }
          }
          for (const video of videos) Object.assign(video, uniqueVideos.get(video.id));
          await store.ingestUnit(unit(messages, next, catalog));
          sync = next;
          messagesWritten += messages.length;
          if (messages.some(message => !["event", "excluded", "unknown"].includes(message.kind ?? "text"))) covered = true;
          if (messages.some(message => ((message.sourceFlags ?? 1) & 1) !== 0 && !["event", "excluded", "unknown"].includes(message.kind ?? "text"))) verifiedRoomContent = true;
        };
        if ((stream === "album" || stream === "post_images") && store.pendingCatalog && source.retryCatalog && catalogRetryLimit > 0) {
          const pending = await store.pendingCatalog(member.id, stream, catalogRetryLimit);
          if (pending.length) {
            try {
              const retried = await source.retryCatalog(member, stream, pending);
              const now = new Date().toISOString();
              await write(retried.items, { ...sync, status: retried.unverified ? "failed" : "ok", lastError: retried.unverified ? sync.lastError : null,
                lastSuccessAt: now, lastNonemptyAt: retried.items.length ? now : sync.lastNonemptyAt }, retried.catalog);
            } catch (error) {
              // Rotate failed lookups without letting one old item block new
              // discovery. Originals remain private and the source stays failed.
              await store.ingestUnit(unit([], undefined, pending));
              console.error(JSON.stringify({ event: "catalog_retry_failed", memberId: member.id, source: stream, error: error instanceof Error ? error.message : "Verification failed." }));
            }
          }
        }
        // Each source has independent newest-page and backfill progress. When a
        // budget expires mid-increment, retain its cursor AND the old boundary.
        const initial = !sync.latestAt;
        let cursor = initial ? sync.historyCursor ?? sync.incrementalCursor : sync.incrementalCursor;
        for (let pageNumber = 0; pageNumber < (options.historyOnly && (sync.latestAt || sync.historyDone) ? 0 : maxPages); pageNumber++) {
          const page = await readPage(cursor);
          if (page.unverified && !(page.catalog && store.pendingCatalog)) {
            const now = new Date().toISOString();
            await write(page.items, { ...sync, lastSuccessAt: now, lastNonemptyAt: page.items.length ? now : sync.lastNonemptyAt });
            throw new Error(`${page.unverified} catalog items lack verifiable authorship; matched records retained, cursor unchanged.`);
          }
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
            ...(initial && (observed > 0 || page.nextCursor !== null) ? { historyCursor: page.nextCursor, historyDone: page.nextCursor === null } : {}),
          };
          await write(page.items, next, page.catalog);
          if (finished) break;
          cursor = page.nextCursor;
        }
        // Never start a fresh backfill at null after a successful exhaustion.
        if (!sync.historyDone && sync.historyCursor !== null) {
          for (let pageNumber = 0; pageNumber < historyPages; pageNumber++) {
            const page = await readPage(sync.historyCursor);
            if (page.unverified && !(page.catalog && store.pendingCatalog)) {
              await write(page.items, sync);
              throw new Error(`${page.unverified} catalog items lack verifiable authorship; history cursor unchanged.`);
            }
            const now = new Date().toISOString();
            const boundary = page.boundary ?? page.items.map(item => ({ id: item.id, occurredAt: item.occurredAt }));
            const latestAt = boundary.reduce<string | null>((at, item) => !at || item.occurredAt > at ? item.occurredAt : at, null);
            const latestIds = boundary.filter(item => item.occurredAt === latestAt).map(item => item.id);
            if (!sync.latestAt && latestIds.length > 100) throw new Error("Too many messages share a sync boundary; refusing to lose boundary IDs.");
            await write(page.items, { ...sync, ...(!sync.latestAt && latestAt ? { latestAt, latestIds } : {}), historyCursor: page.nextCursor, historyDone: page.nextCursor === null,
              status: page.items.length ? "ok" : "empty", lastError: null, lastSuccessAt: now, lastNonemptyAt: page.items.some(item => !["event", "excluded", "unknown"].includes(item.kind ?? "text")) ? now : sync.lastNonemptyAt }, page.catalog);
            if (sync.historyDone) break;
          }
        }
        if ((stream === "album" || stream === "post_images") && store.pendingCatalog && (await store.pendingCatalog(member.id, stream, 1)).length) throw new Error("Catalog discovery checkpoint saved; unverified entries retained in the private retry queue.");
        if (stream === "room") roomSync = sync;
      } catch (error) {
        errorCount += 1;
        lastError = error instanceof Error ? error.message : "Collection failed.";
        sync = { ...sync, status: "failed", lastError: lastError.slice(0, 1000) };
        await store.ingestUnit(unit([], sync));
        console.error(JSON.stringify({ event: "source_failed", memberId: member.id, source: stream, error: lastError }));
      }
    }
    // Album verification can find genuine older member messages beyond pages of
    // fan chat. Record that evidence without changing newest/history boundaries.
    if (roomSync && !roomSync.lastNonemptyAt) {
      const now = new Date().toISOString();
      if (verifiedRoomContent) await store.ingestUnit(unit([], { ...roomSync, status: "ok", lastError: null, lastNonemptyAt: now }));
      else {
        errorCount += 1;
        lastError = "No attributable member room messages observed yet; collection is not verified.";
        await store.ingestUnit(unit([], { ...roomSync, status: "failed", lastError }));
        console.error(JSON.stringify({ event: "source_failed", memberId: member.id, source: "room", error: lastError }));
      }
    }
    if (covered) membersCovered += 1;
    await store.ingestUnit(unit([]));
  }
  if (imageFailures > 0) { errorCount += imageFailures; lastError = `${imageFailures} image uploads failed; retained for retry.`; }
  if (videoFailures > 0) { errorCount += videoFailures; lastError = `${videoFailures} video uploads failed; retained for retry.`; }
  await store.completeBatch({ batchId, completedAt: new Date().toISOString(), membersCovered, totalMembers: members.length, errorCount, errorMessage: lastError });
  return { batchId, statDate, totalMembers: members.length, membersCovered, errorCount, messagesWritten, imageFailures, videoFailures };
}
