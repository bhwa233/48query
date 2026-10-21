import type { CatalogEntry } from "@starter/shared";
import type { CollectionSource, CollectorMessage, CollectorSource, CollectorStore, IngestUnit, SourceSync } from "./types";
import { CollectorStoreError, SourceAuthenticationError, SourceVerificationPending } from "./types";
import type { ScopedCheckpoints } from "./collection-scope";
import { CollectionStopped, type CollectionBudget } from "./budget";

const emptySync = (source: CollectionSource): SourceSync => ({ source, historyCursor: null, historyDone: false, latestAt: null, latestIds: [], incrementalCursor: null, pendingLatestAt: null, pendingLatestIds: [], status: "pending", lastError: null, lastSuccessAt: null, lastNonemptyAt: null });
const shanghaiDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export async function runBatch(source: CollectorSource, store: CollectorStore, options: { since?: string; checkpoints?: ScopedCheckpoints; budget?: CollectionBudget; statDate?: string; batchId?: string; maxPagesPerMember?: number; maxHistoryPagesPerMember?: number; maxMembers?: number; historyOnly?: boolean; retrySkipped?: boolean; catalogRetryLimit?: number; archiveImage?: (image: NonNullable<CollectorMessage["images"]>[number]) => Promise<void>; archiveVideo?: (video: NonNullable<CollectorMessage["videos"]>[number]) => Promise<void> } = {}) {
  if (options.since && (!Number.isFinite(Date.parse(options.since)) || !options.checkpoints)) throw new Error("Date-limited collection requires valid, separate scoped checkpoints.");
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
  let sourcesPending = 0;
  let sourcesSkipped = 0;
  let budgetReached = false;
  const streams = source.sources ?? ["room"];

  for (const member of members) {
    if (options.budget?.stopped) { budgetReached = true; break; }
    const state = await store.getSyncState(member.id);
    if (state && options.checkpoints) state.sources = options.checkpoints.read(member.id);
    let covered = false;
    let roomSync: SourceSync | undefined;
    let verifiedRoomContent = false;
    const pendingStreams = new Set<CollectionSource>();
    const unit = (messages: CollectorMessage[], sync?: SourceSync, catalog?: CatalogEntry[]): IngestUnit => ({ catalog, batchId, statDate, startedAt, member, messages, recordings: [], messageCursor: state?.messageCursor ?? null, recordingCursor: state?.recordingCursor ?? null, totalMembers: members.length, membersCovered, errorCount, ...(sync && !options.checkpoints ? { sync } : {}) });
    const persist = async (messages: CollectorMessage[], sync?: SourceSync, catalog?: CatalogEntry[]) => {
      await store.ingestUnit(unit(messages, sync, catalog));
      if (sync) await options.checkpoints?.write(member.id, sync);
    };
    const recordIssue = async (sync: SourceSync, error: unknown) => {
      const reason = error instanceof Error ? error.message : "Collection failed.";
      const failureCount = Math.min(3, (sync.failureCount ?? (sync.status === "failed" ? 1 : 0)) + 1);
      const skippedAt = failureCount >= 3 ? new Date().toISOString() : null;
      const pending = error instanceof SourceVerificationPending;
      const next: SourceSync = { ...sync, failureCount, skippedAt, status: pending ? "pending" : "failed", lastError: reason.slice(0, 1000) };
      // A skipped source remains incomplete. Infrastructure/authentication errors
      // never enter this path, even when a source has reached its failure limit.
      await persist([], next);
      if (!pending && !skippedAt) { errorCount += 1; lastError = reason; }
      if (skippedAt) sourcesSkipped += 1;
      pendingStreams.add(sync.source);
      console[!pending && !skippedAt ? "error" : "log"](JSON.stringify({ event: skippedAt ? "source_skipped" : pending ? "source_pending" : "source_failed", memberId: member.id, source: sync.source, failureCount, error: reason }));
      return next;
    };
    // Register before any source can fail, preserving the original error on completion.
    await store.ingestUnit(unit([]));
    if (source.readFollowers) {
      try {
        const followerSnapshot = await source.readFollowers(member);
        if (followerSnapshot) await store.ingestUnit({ ...unit([]), followerSnapshot });
        console.log(JSON.stringify({ event: followerSnapshot ? "followers_collected" : "followers_unavailable", memberId: member.id }));
      } catch (error) {
        if (error instanceof CollectionStopped || options.budget?.stopped) { budgetReached = true; break; }
        if (error instanceof SourceAuthenticationError || error instanceof CollectorStoreError) throw error;
        errorCount += 1;
        lastError = error instanceof Error ? error.message : "Follower collection failed.";
        console.error(JSON.stringify({ event: "followers_failed", memberId: member.id, error: lastError }));
      }
    }
    for (const stream of streams) {
      if (options.budget?.stopped) { budgetReached = true; break; }
      let sync = structuredClone((options.checkpoints?.read(member.id) ?? state?.sources)?.find(item => item.source === stream) ?? emptySync(stream));
      sync.failureCount ??= sync.status === "failed" ? 1 : 0;
      if (sync.skippedAt && options.retrySkipped) {
        sync = { ...sync, failureCount: 0, skippedAt: null };
        await persist([], sync);
      }
      if (sync.skippedAt) {
        sourcesSkipped += 1;
        pendingStreams.add(stream);
        console.log(JSON.stringify({ event: "source_skipped", memberId: member.id, source: stream, failureCount: sync.failureCount, error: sync.lastError }));
        continue;
      }
      let catalogPending = false;
      let sourceFailure = false;
      let sourceRead = false;
      let catalogReadError: Error | undefined;
      try {
        const readPage = async (cursor: string | null) => {
          options.budget?.check();
          console.log(JSON.stringify({ event: "source_page_started", memberId: member.id, source: stream, phase: options.historyOnly ? "history" : "incremental" }));
          let page;
          try { page = await (source.listContent ? source.listContent(member, stream, cursor) : source.listMessages(member, cursor)); }
          catch (error) { sourceFailure = true; throw error; }
          sourceRead = true;
          if (!options.since) return page;
          const boundary = page.boundary ?? page.items.map(item => ({ id: item.id, occurredAt: item.occurredAt }));
          const times = boundary.map(item => Date.parse(item.occurredAt));
          const reached = page.reachedSince || times.length > 0 && times.every((at, index) => Number.isFinite(at) && (index === 0 || at <= times[index - 1]!)) && times.some(at => at < Date.parse(options.since!));
          return { ...page, items: page.items.filter(item => Date.parse(item.occurredAt) >= Date.parse(options.since!)), boundary: boundary.filter(item => Date.parse(item.occurredAt) >= Date.parse(options.since!)), nextCursor: reached ? null : page.nextCursor };
        };
        const write = async (messages: CollectorMessage[], next: SourceSync, catalog?: CatalogEntry[]) => {
          if (options.since) messages = messages.filter(message => Date.parse(message.occurredAt) >= Date.parse(options.since!));
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
                catch { options.budget?.check(); image.status = "failed"; imageFailures += 1; }
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
              catch { options.budget?.check(); video.status = "failed"; videoFailures += 1; }
              await store.saveVideo?.(video);
            }
          }
          for (const video of videos) Object.assign(video, uniqueVideos.get(video.id));
          await persist(messages, next, catalog);
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
              sourceRead = true;
              const now = new Date().toISOString();
              await write(retried.items, { ...sync, status: retried.unverified ? "pending" : "ok", lastError: retried.unverified ? sync.lastError : null,
                lastSuccessAt: now, lastNonemptyAt: retried.items.length ? now : sync.lastNonemptyAt }, retried.catalog);
            } catch (error) {
              options.budget?.check();
              if (error instanceof CollectorStoreError || error instanceof SourceAuthenticationError) throw error;
              catalogReadError = error instanceof Error ? error : new Error("Catalog verification request failed.");
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
            throw new SourceVerificationPending(`${page.unverified} catalog items lack verifiable authorship; matched records retained, cursor unchanged.`);
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
            ...(initial && (options.since || observed > 0 || page.nextCursor !== null) ? { historyCursor: page.nextCursor, historyDone: page.nextCursor === null } : {}),
          };
          await write(page.items, next, page.catalog);
          console.log(JSON.stringify({ event: "source_page_committed", memberId: member.id, source: stream, messages: page.items.length, historyDone: next.historyDone }));
          if (finished) break;
          cursor = page.nextCursor;
        }
        // Never start a fresh backfill at null after a successful exhaustion.
        if (!sync.historyDone && sync.historyCursor !== null) {
          for (let pageNumber = 0; pageNumber < historyPages; pageNumber++) {
            const page = await readPage(sync.historyCursor);
            if (page.unverified && !(page.catalog && store.pendingCatalog)) {
              await write(page.items, sync);
              throw new SourceVerificationPending(`${page.unverified} catalog items lack verifiable authorship; history cursor unchanged.`);
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
        if ((stream === "album" || stream === "post_images") && store.pendingCatalog && (await store.pendingCatalog(member.id, stream, 1)).length) {
          catalogPending = true;
          console.log(JSON.stringify({ event: "catalog_pending", memberId: member.id, source: stream }));
          if (catalogReadError) { sourceFailure = true; throw catalogReadError; }
        }
        if (sourceRead && sync.failureCount && (stream !== "room" || sync.lastNonemptyAt || verifiedRoomContent || options.since && sync.historyDone)) {
          sync = { ...sync, failureCount: 0, skippedAt: null };
          await persist([], sync);
        }
        if (stream === "room") roomSync = sync;
      } catch (error) {
        if (error instanceof CollectionStopped || options.budget?.stopped) { budgetReached = true; break; }
        if (error instanceof CollectorStoreError || error instanceof SourceAuthenticationError || (!sourceFailure && !(error instanceof SourceVerificationPending))) throw error;
        sync = await recordIssue(sync, error);
        if (stream === "room") roomSync = sync;
      }
      if (catalogPending || !sync.historyDone || sync.incrementalCursor !== null || sync.lastError) pendingStreams.add(stream);
    }
    // Album verification can find genuine older member messages beyond pages of
    // fan chat. Record that evidence without changing newest/history boundaries.
    if (!budgetReached && roomSync && !roomSync.lastNonemptyAt && !roomSync.skippedAt) {
      const now = new Date().toISOString();
      if (verifiedRoomContent) await persist([], { ...roomSync,
        ...(roomSync.lastError ? {} : { status: "ok" as const, lastError: null }), lastNonemptyAt: now });
      else if (!roomSync.lastError && !(options.since && roomSync.historyDone)) {
        await recordIssue(roomSync, new SourceVerificationPending("No attributable member room messages observed yet; collection is not verified."));
      }
    }
    sourcesPending += pendingStreams.size;
    if (covered) membersCovered += 1;
    await store.ingestUnit(unit([]));
    if (budgetReached) break;
  }
  if (imageFailures > 0) { errorCount += imageFailures; lastError = `${imageFailures} image uploads failed; retained for retry.`; }
  if (videoFailures > 0) { errorCount += videoFailures; lastError = `${videoFailures} video uploads failed; retained for retry.`; }
  await store.completeBatch({ batchId, completedAt: new Date().toISOString(), membersCovered, totalMembers: members.length, errorCount, errorMessage: lastError });
  return { batchId, statDate, totalMembers: members.length, membersCovered, errorCount, messagesWritten, imageFailures, videoFailures, sourcesPending, sourcesSkipped, budgetReached, scopeComplete: !budgetReached && sourcesPending === 0 && errorCount === 0 };
}
