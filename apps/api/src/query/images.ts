import type { ImageAttachment } from "@starter/shared";
import { ImageAttachmentSchema } from "@starter/shared/schemas";

export function imageStatement(db: D1Database, image: ImageAttachment, now: string) {
  return db.prepare(`INSERT INTO query_images (id, source_url, gallery_url, thumbnail_url, width, height, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET gallery_url = COALESCE(query_images.gallery_url, excluded.gallery_url), thumbnail_url = COALESCE(query_images.thumbnail_url, excluded.thumbnail_url),
    width = COALESCE(query_images.width, excluded.width), height = COALESCE(query_images.height, excluded.height),
    status = CASE WHEN query_images.gallery_url IS NOT NULL OR excluded.gallery_url IS NOT NULL THEN 'uploaded' ELSE excluded.status END, updated_at = excluded.updated_at`)
    .bind(image.id, image.sourceUrl, image.galleryUrl ?? null, image.thumbnailUrl ?? null, image.width ?? null, image.height ?? null, image.status, now);
}

export const imageProjection = `id, source_url AS sourceUrl, gallery_url AS galleryUrl, thumbnail_url AS thumbnailUrl, width, height, status`;
export const readImage = (row: unknown): ImageAttachment => ImageAttachmentSchema.parse(row);
