import type { VideoAttachment } from "@starter/shared";
import { VideoAttachmentSchema } from "@starter/shared/schemas";

// Like image progress, video uploads survive page retries independently. Keep a
// previously uploaded URL and its measured byte count together on later upserts.
export function videoStatement(db: D1Database, video: VideoAttachment, now: string) {
  return db.prepare(`INSERT INTO query_videos (id, source_url, gallery_url, thumbnail_url, bytes, status, skip_reason, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET gallery_url = COALESCE(query_videos.gallery_url, excluded.gallery_url), thumbnail_url = COALESCE(query_videos.thumbnail_url, excluded.thumbnail_url),
    bytes = CASE WHEN query_videos.gallery_url IS NOT NULL THEN query_videos.bytes ELSE COALESCE(excluded.bytes, query_videos.bytes) END,
    status = CASE WHEN query_videos.gallery_url IS NOT NULL OR excluded.gallery_url IS NOT NULL THEN 'uploaded' WHEN query_videos.status = 'skipped' THEN 'skipped' ELSE excluded.status END,
    skip_reason = CASE WHEN query_videos.gallery_url IS NOT NULL OR excluded.gallery_url IS NOT NULL THEN NULL ELSE COALESCE(excluded.skip_reason, query_videos.skip_reason) END, updated_at = excluded.updated_at`)
    .bind(video.id, video.sourceUrl, video.galleryUrl ?? null, video.thumbnailUrl ?? null, video.bytes ?? null, video.status, video.skipReason ?? null, now);
}
export const videoProjection = `id, source_url AS sourceUrl, gallery_url AS galleryUrl, thumbnail_url AS thumbnailUrl, bytes, status, skip_reason AS skipReason`;
export const readVideo = (row: unknown): VideoAttachment => VideoAttachmentSchema.parse(row);
