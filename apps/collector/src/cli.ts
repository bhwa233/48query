import { DemoSource } from "./demo-source";
import { DryRunStore } from "./dry-run-store";
import { HttpIngestStore } from "./http-store";
import { COLLECTION_SOURCES, Pocket48Source } from "./pocket48-source";
import { GalleryUploader, MediaSizeLimitError } from "./gallery";
import type { VideoAttachment } from "@starter/shared";
import type { CollectionSource, CollectorStore } from "./types";
import { createPocket48Pa, loadCredential, CREDENTIAL_PATH } from "./pocket48-auth.mjs";
import { runBatch } from "./run";

async function loadProductionCredential() {
  const endpoint = process.env.COLLECTOR_CREDENTIALS_URL?.trim();
  const readToken = process.env.COLLECTOR_CREDENTIAL_READ_TOKEN?.trim();
  if (!endpoint && !readToken) return loadCredential();
  if (!endpoint || !readToken) throw new Error("Collector credential endpoint and read token must be configured together.");
  let response;
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${readToken}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Unable to reach the collector credential endpoint.");
  }
  if (!response.ok) throw new Error(`Collector credential endpoint returned HTTP ${response.status}.`);
  const payload: unknown = await response.json().catch(() => null) as unknown;
  const payloadRecord = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const data = payloadRecord?.data && typeof payloadRecord.data === "object"
    ? payloadRecord.data as Record<string, unknown>
    : null;
  const token = typeof data?.token === "string" ? data.token.trim() : "";
  const deviceId = typeof data?.deviceId === "string" ? data.deviceId.trim() : "";
  if (!token || !deviceId) throw new Error("Collector credential endpoint returned an invalid credential.");
  return { token, deviceId };
}

const dryRun = process.argv.includes("--dry-run") || process.env.COLLECTOR_DRY_RUN === "1";
const sourceName = process.env.COLLECTOR_SOURCE ?? "demo";
const memberId = process.env["COLLECTOR_MEMBER_ID"]?.trim();
const memberScope = process.env["COLLECTOR_MEMBER_SCOPE"]?.trim() || "followed";
if (memberScope !== "followed" && memberScope !== "all") throw new Error("COLLECTOR_MEMBER_SCOPE must be followed or all.");
const endpoint = process.env["INGEST_API_URL"];
const authKey = process.env["INGEST_KEY"];
const store: CollectorStore = !dryRun && endpoint && authKey ? new HttpIngestStore(endpoint, authKey) : new DryRunStore();
const stored = sourceName === "pocket48" ? await loadProductionCredential() : null;
const sourceOptions = {
  ["token"]: process.env["POCKET48_TOKEN"] ?? stored?.token ?? "",
  deviceId: process.env["POCKET48_DEVICE_ID"] ?? stored?.deviceId,
  pa: process.env["POCKET48_PA"],
  paFactory: process.env["POCKET48_PA"] ? undefined : createPocket48Pa,
  apiBaseUrl: process.env["POCKET48_API_BASE_URL"],
  directoryUrl: process.env["POCKET48_DIRECTORY_URL"],
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
const source = sourceName === "demo"
  ? new DemoSource()
  : sourceName === "pocket48"
    ? new Pocket48Source(sourceOptions)
    : (() => { throw new Error(`Unsupported collector source: ${sourceName}.`); })();
const batchSource = memberId
  ? {
    listMembers: async () => (await source.listMembers()).filter((member) => member.id === memberId),
    listMessages: source.listMessages.bind(source),
    sources: source.sources,
    listContent: source.listContent?.bind(source),
  }
  : source;


if (sourceName === "pocket48" && !sourceOptions["token"]) throw new Error(`Pocket48 credential not found. Run the login command first: ${CREDENTIAL_PATH}`);
if (!dryRun && (!endpoint || !authKey)) throw new Error("INGEST_API_URL and INGEST_KEY are required for writes; use --dry-run to inspect safely.");
const maxMembers = Number(process.env["COLLECTOR_MAX_MEMBERS"] ?? 0);
const maxPagesPerMember = Number(process.env["COLLECTOR_MAX_PAGES"] ?? 10);
const historyBudget = process.env.COLLECTOR_HISTORY_PAGES?.trim();
const maxHistoryPagesPerMember = historyBudget ? Number(historyBudget) : undefined;
const gallery = new GalleryUploader({ baseUrl: process.env.GALLERY_BASE_URL });
const archiveImage = !dryRun && sourceName === "pocket48" ? gallery.upload.bind(gallery) : undefined;
const maxVideoMiB = Number(process.env.COLLECTOR_VIDEO_MAX_MIB ?? 50);
if (!Number.isFinite(maxVideoMiB) || maxVideoMiB <= 0 || maxVideoMiB > 50) throw new Error("COLLECTOR_VIDEO_MAX_MIB must be greater than zero and at most 50.");
const archiveVideo = !dryRun && sourceName === "pocket48" ? async (video: VideoAttachment) => {
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
let retryFailures = 0;
if (archiveImage && store.pendingImages) {
  const limit = Number(process.env.COLLECTOR_IMAGE_RETRY_LIMIT ?? 25);
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) throw new Error("Image retry limit must be between 0 and 100.");
  for (const image of limit > 0 ? await store.pendingImages(limit) : []) {
    try { await archiveImage(image); } catch { image.status = "failed"; retryFailures += 1; }
    await store.saveImage?.(image);
  }
}
if (archiveVideo && store.pendingVideos) {
  for (const video of await store.pendingVideos(25)) {
    try { await archiveVideo(video); } catch { video.status = "failed"; retryFailures += 1; }
    await store.saveVideo?.(video);
  }
}
const result = await runBatch(batchSource, store, { maxMembers, maxPagesPerMember, maxHistoryPagesPerMember, archiveImage, archiveVideo });
console.log(JSON.stringify({ event: "batch_finished", ...result }));
if ((result.errorCount > 0 || retryFailures > 0) && process.env["COLLECTOR_FAIL_ON_ERROR"] !== "0") process.exitCode = 1;
