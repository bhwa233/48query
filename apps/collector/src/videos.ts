import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { GalleryUploader } from "./gallery";
import { Pocket48Source } from "./pocket48-source";
import { object, parsePocketJson, string } from "./pocket48-content";
import { CREDENTIAL_PATH, createPocket48Pa, loadCredential } from "./pocket48-auth.mjs";
import { collectionSince } from "./collection-scope";

const memberId = process.env.COLLECTOR_MEMBER_ID?.trim();
if (!memberId) throw new Error("Set COLLECTOR_MEMBER_ID to inspect that member's short videos.");
const upload = process.argv.includes("--upload");
const since = collectionSince();
const maxMiB = Number(process.env.COLLECTOR_VIDEO_MAX_MIB ?? 50);
const maxPages = Number(process.env.COLLECTOR_VIDEO_MAX_PAGES ?? 1);
if (!Number.isFinite(maxMiB) || maxMiB <= 0 || maxMiB > 50) throw new Error("COLLECTOR_VIDEO_MAX_MIB must be greater than 0 and no more than 50.");
if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error("COLLECTOR_VIDEO_MAX_PAGES must be between 1 and 100.");
const maxBytes = Math.floor(maxMiB * 1024 * 1024);
const credential = await loadCredential();
if (!credential?.token) throw new Error("No local Pocket48 credential found. Run the login command first.");
const source = new Pocket48Source({ token: credential.token, since, deviceId: credential.deviceId, paFactory: createPocket48Pa, memberScope: "all", minIntervalMs: Number(process.env.POCKET48_MIN_INTERVAL_MS ?? 5000) });
const member = (await source.listMembers()).find(member => member.id === memberId);
if (!member) throw new Error("Selected member is not in the member directory.");
const gallery = new GalleryUploader({ baseUrl: process.env.GALLERY_BASE_URL });
const manifestPath = process.env.POCKET48_VIDEO_MANIFEST ?? path.join(path.dirname(CREDENTIAL_PATH), "video-uploads.json");
let previous: Record<string, unknown> = {};
try { previous = object(parsePocketJson(await readFile(manifestPath, "utf8"))); }
catch (error) { if (object(error).code !== "ENOENT") throw error; }
const entries = new Map<string, Record<string, unknown>>((Array.isArray(previous.videos) ? previous.videos : []).flatMap(value => {
  const row = object(value);
  const url = string(row.sourceUrl);
  return url ? [[url, row] as const] : [];
}));
let cursor = previous.since === since ? process.env.COLLECTOR_VIDEO_CURSOR?.trim() || string(previous.albumNextCursor) : null;
let observed = 0;
let uploaded = 0;
let cached = 0;
let skipped = 0;
let failed = 0;
let totalBytes = 0;
const persist = async () => {
  await mkdir(path.dirname(manifestPath), { recursive: true, mode: 0o700 });
  const temporary = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, since, checkedAt: new Date().toISOString(), memberId, maxBytes, albumNextCursor: cursor, videos: [...entries.values()] }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, manifestPath);
};
for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
  const page = await source.listRoomVideos(member, cursor);
  observed += page.observed;
  failed += page.unverified;
  // Keep the requested cursor until every selected upload result is persisted.
  for (const video of page.videos) {
    const existing = entries.get(video.sourceUrl);
    if (existing?.status === "uploaded" && typeof existing.galleryUrl === "string" && /^https:\/\//.test(existing.galleryUrl)) { cached += 1; continue; }
    let bytes: number | null = null;
    let skipReason: string | null = null;
    let error: string | null = null;
    try {
      bytes = await gallery.videoSize(video.sourceUrl);
      if (bytes === null) { skipReason = "unknown_size"; skipped += 1; failed += 1; }
      else if (bytes > maxBytes) { skipReason = "too_large"; skipped += 1; }
      else if (upload) { bytes = await gallery.uploadVideo(video, maxBytes); uploaded += 1; }
      if (bytes !== null) totalBytes += bytes;
    } catch {
      // Avoid printing source URLs or upstream bodies in terminal logs.
      video.status = "failed"; failed += 1; error = "Video request or upload failed; retry the local command.";
    }
    entries.set(video.sourceUrl, { ...video, bytes, skipReason, error });
    await persist();
    console.log(JSON.stringify({ event: "video_result", memberId: video.memberId, id: video.id, bytes, status: video.status, skipReason, error }));
  }
  if (failed === 0) cursor = page.nextCursor;
  await persist();
  console.log(JSON.stringify({ event: "video_page", observed: page.observed, verified: page.videos.length, unverified: page.unverified, nextCursor: page.nextCursor }));
  if (failed > 0 || page.nextCursor === null) break;
  cursor = page.nextCursor;
}
console.log(JSON.stringify({ event: "videos_complete", observed, uploaded, cached, skipped, failed, totalBytes, maxBytes, manifestPath }));
if (failed > 0) process.exitCode = 1;
