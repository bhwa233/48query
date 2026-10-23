import { DemoSource } from "./demo-source";
import { DryRunStore } from "./dry-run-store";
import { HttpIngestStore } from "./http-store";
import { COLLECTION_SOURCES, Pocket48Source } from "./pocket48-source";
import { GalleryUploader, MediaSizeLimitError } from "./gallery";
import type { VideoAttachment } from "@starter/shared";
import type { CollectionSource, CollectorStore, SourceSync } from "./types";
import { createPocket48Pa, CREDENTIAL_PATH } from "./pocket48-auth.mjs";
import { runBatch } from "./run";
import { retryMedia } from "./media-retry";
import { loadProductionCredential } from "./credentials";
import { collectionSince, openScopedCheckpoints } from "./collection-scope";
import { dirname, join } from "node:path";
import { CollectionBudget } from "./budget";
import { collectMelee } from "./melee";
import { collectorHealth, writeCollectorReport } from "./collector-report";
import { randomUUID } from "node:crypto";

const backfillOnly = process.argv.includes("--backfill");
const mediaOnly = process.argv.includes("--retry-media");
const dryRun = process.argv.includes("--dry-run") || process.env.COLLECTOR_DRY_RUN === "1";
const sourceName = process.env.COLLECTOR_SOURCE ?? (mediaOnly ? "pocket48" : "demo");
const since = sourceName === "pocket48" ? collectionSince() : undefined;
const maxSeconds = Number(process.env.COLLECTOR_MAX_SECONDS ?? 0);
if (!Number.isInteger(maxSeconds) || maxSeconds < 0 || maxSeconds > 3600) throw new Error("COLLECTOR_MAX_SECONDS must be between 0 and 3600.");
const budget = new CollectionBudget(maxSeconds ? Date.now() + maxSeconds * 1000 : Infinity);
let activeBudget = budget;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => budget.stop());
if (mediaOnly && process.env.COLLECTOR_DEFER_MEDIA === "1") throw new Error("Unset COLLECTOR_DEFER_MEDIA before retrying media.");
if (mediaOnly && (dryRun || sourceName !== "pocket48")) throw new Error("Media retries require the Pocket48 source and a writable ingestion store.");
if (backfillOnly && (mediaOnly || dryRun || sourceName !== "pocket48")) throw new Error("Backfill requires a writable Pocket48 source.");
const memberId = process.env["COLLECTOR_MEMBER_ID"]?.trim();
const memberScope = process.env["COLLECTOR_MEMBER_SCOPE"]?.trim() || "followed";
if (memberScope !== "followed" && memberScope !== "all") throw new Error("COLLECTOR_MEMBER_SCOPE must be followed or all.");
const endpoint = process.env["INGEST_API_URL"];
const authKey = process.env["INGEST_KEY"];
const store: CollectorStore = !dryRun && endpoint && authKey ? new HttpIngestStore(endpoint, authKey, since, budget) : new DryRunStore();
const healthEntries = new Map<string, SourceSync[]>();
let retries: Awaited<ReturnType<typeof retryMedia>> = { imageAttempts: 0, videoAttempts: 0, failures: 0, persistentFailures: 0, health: [], budgetReached: false };
let melee = { errors: 0 };
let errorCount = 0;
let pagesCommitted = 0;
let complete = false;
try {
const stored = sourceName === "pocket48" && !mediaOnly ? await loadProductionCredential() : null;
const sourceOptions = {
  budget: () => activeBudget,
  maxOriginalLookups: maxSeconds ? 12 : undefined,
  since,
  ["token"]: process.env["POCKET48_TOKEN"] ?? stored?.token ?? "",
  deviceId: process.env["POCKET48_DEVICE_ID"] ?? stored?.deviceId,
  pa: process.env["POCKET48_PA"],
  paFactory: process.env["POCKET48_PA"] ? undefined : createPocket48Pa,
  apiBaseUrl: process.env["POCKET48_API_BASE_URL"],
  directoryUrl: process.env["POCKET48_DIRECTORY_URL"],
  albumOriginalPages: Number(process.env.POCKET48_ALBUM_ORIGINAL_PAGES ?? 3),
  minIntervalMs: Number(process.env["POCKET48_MIN_INTERVAL_MS"] ?? 5000),
  memberScope: memberId ? "all" : memberScope,
  requestedMemberId: memberId,
  readVerifiedPostImages: !dryRun ? store.verifiedPostImages?.bind(store) : undefined,
  readVerifiedMedia: !dryRun ? store.verifiedRoomMedia?.bind(store) : undefined,
  sources: (process.env.COLLECTOR_SOURCES?.split(",").map(value => value.trim()).filter(Boolean) ?? COLLECTION_SOURCES).map(value => {
    if (!COLLECTION_SOURCES.includes(value as CollectionSource)) throw new Error(`Unsupported collection source: ${value}`);
    return value as CollectionSource;
  }),
} satisfies ConstructorParameters<typeof Pocket48Source>[0];
const source = mediaOnly || sourceName === "demo"
  ? new DemoSource()
  : sourceName === "pocket48"
    ? new Pocket48Source(sourceOptions)
    : (() => { throw new Error(`Unsupported collector source: ${sourceName}.`); })();
const batchSource = memberId
  ? {
    listMembers: async () => (await source.listMembers()).filter((member) => member.id === memberId),
    listMessages: source.listMessages.bind(source),
    readFollowers: source instanceof Pocket48Source ? source.readFollowers.bind(source) : undefined,
    sources: source.sources,
    retryCatalog: source instanceof Pocket48Source ? source.retryCatalog.bind(source) : undefined,
    listContent: source.listContent?.bind(source),
  }
  : source;


if (!mediaOnly && sourceName === "pocket48" && !sourceOptions["token"]) throw new Error(`Pocket48 credential not found. Run the login command first: ${CREDENTIAL_PATH}`);
if (!dryRun && (!endpoint || !authKey)) throw new Error("INGEST_API_URL and INGEST_KEY are required for writes; use --dry-run to inspect safely.");
if (!mediaOnly && !backfillOnly && source instanceof Pocket48Source) {
  activeBudget = budget.slice(180);
  try { melee = await collectMelee(source, store instanceof HttpIngestStore ? store : null, activeBudget); }
  finally { activeBudget = budget; }
}
const maxMembers = Number(process.env["COLLECTOR_MAX_MEMBERS"] ?? 0);
const maxPagesPerMember = Number(process.env["COLLECTOR_MAX_PAGES"] ?? 10);
const historyBudget = process.env.COLLECTOR_HISTORY_PAGES?.trim();
const maxHistoryPagesPerMember = historyBudget ? Number(historyBudget) : backfillOnly ? 100 : undefined;
const gallery = new GalleryUploader({ baseUrl: process.env.GALLERY_BASE_URL, budget });
const archiveImage = !dryRun && process.env.COLLECTOR_DEFER_MEDIA !== "1" && sourceName === "pocket48" ? gallery.upload.bind(gallery) : undefined;
const maxVideoMiB = Number(process.env.COLLECTOR_VIDEO_MAX_MIB ?? 50);
if (!Number.isFinite(maxVideoMiB) || maxVideoMiB <= 0 || maxVideoMiB > 50) throw new Error("COLLECTOR_VIDEO_MAX_MIB must be greater than zero and at most 50.");
const archiveVideo = !dryRun && process.env.COLLECTOR_DEFER_MEDIA !== "1" && sourceName === "pocket48" ? async (video: VideoAttachment) => {
  const maxBytes = Math.floor(maxVideoMiB * 1024 * 1024);
  video.bytes = await gallery.videoSize(video.sourceUrl);
  try {
    if (video.bytes && video.bytes > maxBytes) throw new MediaSizeLimitError();
    video.bytes = await gallery.uploadVideo(video, maxBytes);
    video.skipReason = null;
  } catch (error) {
    if (!(error instanceof MediaSizeLimitError)) throw error;
    video.status = "skipped"; video.skipReason = "too_large";
  }
} : undefined;
retries = await retryMedia(store, { archiveImage, archiveVideo, mediaOnly,
  budget, since,
  imageLimit: Number(process.env.COLLECTOR_IMAGE_RETRY_LIMIT ?? (mediaOnly ? 100 : 25)),
  maxBatches: mediaOnly ? Number(process.env.COLLECTOR_MEDIA_RETRY_BATCHES ?? 100) : 1 });
const memoryCheckpoints = new Map<string, SourceSync[]>();
const checkpoints = since && !mediaOnly ? dryRun ? {
  read: (id: string) => memoryCheckpoints.get(id) ?? [],
  write: async (id: string, sync: SourceSync) => { memoryCheckpoints.set(id, [...(memoryCheckpoints.get(id) ?? []).filter(item => item.source !== sync.source), sync]); },
} : await openScopedCheckpoints(process.env.COLLECTOR_CHECKPOINT_STATE ?? join(dirname(CREDENTIAL_PATH), "collection-scope.json"), since, store instanceof HttpIngestStore ? store : undefined) : undefined;
const runOptions = { since, checkpoints, budget, maxMembers, maxPagesPerMember, maxHistoryPagesPerMember, historyOnly: backfillOnly || process.env.COLLECTOR_HISTORY_ONLY === "1", retrySkipped: process.argv.includes("--retry-skipped"), catalogRetryLimit: Number(process.env.COLLECTOR_CATALOG_RETRY_LIMIT ?? 10), archiveImage, archiveVideo };
const reportCheckpoints = checkpoints ? { read: (id: string) => checkpoints.read(id), write: async (id: string, sync: SourceSync) => {
  await checkpoints.write(id, sync);
  healthEntries.set(id, checkpoints.read(id));
} } : undefined;
Object.assign(runOptions, { checkpoints: reportCheckpoints, runId: process.env.GITHUB_RUN_ID
  ? `gha-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}` : `local-${randomUUID()}` });
if (backfillOnly) {
  if (mediaOnly || dryRun || !(source instanceof Pocket48Source)) throw new Error("Backfill requires a writable Pocket48 source.");
  const allMembers = await batchSource.listMembers();
  const members = maxMembers > 0 ? allMembers.slice(0, maxMembers) : allMembers;
  if (!members.length) throw new Error("No members found for backfill.");
  for (const member of members) {
    if (budget.stopped) break;
    for (const stream of source.sources) {
      if (budget.stopped) break;
      const singleSource = { sources: [stream], listMembers: async () => [member], listMessages: source.listMessages.bind(source), listContent: source.listContent.bind(source), retryCatalog: source.retryCatalog.bind(source) };
      try {
        const sync = (checkpoints?.read(member.id) ?? (await store.getSyncState(member.id))?.sources)?.find(item => item.source === stream);
        const pending = (stream === "album" || stream === "post_images") && store.pendingCatalog ? await store.pendingCatalog(member.id, stream, 1) : [];
        if (sync?.historyDone && !pending.length) continue;
        const result = await runBatch(singleSource, store, runOptions);
        errorCount += result.errorCount;
        pagesCommitted += result.pagesCommitted;
        if (since && !result.scopeComplete) console.log(JSON.stringify({ event: "collection_pending", batchId: result.batchId }));
        console.log(JSON.stringify({ event: "backfill_source_finished", memberId: member.id, source: stream, ...result }));
      } catch (error) {
        if (budget.stopped) break;
        // A bridge outage can also interrupt error-state persistence. Leave its
        // last committed checkpoint intact and continue the remaining sources.
        errorCount += 1;
        console.error(JSON.stringify({ event: "backfill_source_interrupted", memberId: member.id, source: stream, error: error instanceof Error ? error.message : "Backfill interrupted." }));
      }
    }
  }
} else if (!mediaOnly && !budget.stopped) {
  const result = await runBatch(batchSource, store, runOptions);
  errorCount = result.errorCount;
  pagesCommitted += result.pagesCommitted;
  if (since && !result.scopeComplete) console.log(JSON.stringify({ event: "collection_pending", batchId: result.batchId }));
  console.log(JSON.stringify({ event: "batch_finished", ...result }));
} else if (!mediaOnly) {
  console.log(JSON.stringify({ event: "collection_pending", reason: "budget_reached_before_content" }));
}
console.log(JSON.stringify({ event: "collector_finished", errorCount, rankingErrors: melee.errors, retryFailures: retries.persistentFailures, budgetReached: budget.stopped || retries.budgetReached }));
if ((errorCount > 0 || retries.persistentFailures > 0 || melee.errors > 0) && process.env["COLLECTOR_FAIL_ON_ERROR"] !== "0") process.exitCode = 1;
complete = true;
} finally {
  const health = collectorHealth([...([...healthEntries].map(([memberId, sources]) => ({ memberId, sources }))),
    ...retries.health.map(progress => ({ memberId: `media-${progress.kind}`, sources: [{ ...progress.health, source: progress.kind }] }))]);
  await writeCollectorReport(health, { dryRun, errorCount, rankingErrors: melee.errors, retryFailures: retries.persistentFailures, interrupted: !complete, pagesCommitted, transientMediaFailures: retries.failures, budgetReached: budget.stopped || retries.budgetReached });
  if (health.failures > 0 && process.env.COLLECTOR_FAIL_ON_ERROR !== "0") process.exitCode = 1;
}
