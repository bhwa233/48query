import { sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { ArchiveMessage, CollectionSource } from "@starter/shared";
import { readVideo } from "./videos";

export async function readMessages(db: DrizzleD1Database, rows: Record<string, unknown>[]): Promise<ArchiveMessage[]> {
  if (!rows.length) return [];
  const images = await db.all<Record<string, unknown>>(sql`SELECT link.message_id, image.id, image.source_url, image.gallery_url, image.thumbnail_url, image.width, image.height, image.status
    FROM query_message_images link JOIN query_images image ON image.id = link.image_id WHERE link.message_id IN (${sql.join(rows.map(row => sql`${row.id}`), sql`, `)}) ORDER BY link.position, image.id`);
  const videos = await db.all<Record<string, unknown>>(sql`SELECT link.message_id, video.id, video.source_url AS sourceUrl, video.gallery_url AS galleryUrl, video.thumbnail_url AS thumbnailUrl, video.bytes, video.status, video.skip_reason AS skipReason
    FROM query_message_videos link JOIN query_videos video ON video.id = link.video_id WHERE link.message_id IN (${sql.join(rows.map(row => sql`${row.id}`), sql`, `)}) ORDER BY link.position, video.id`);
  return rows.map(row => ({ id: String(row.id), memberId: String(row.member_id), memberName: String(row.member_name), type: String(row.type), text: row.text as string | null, occurredAt: String(row.occurred_at), senderId: row.sender_id as string | null, senderName: row.sender_name as string | null, senderType: row.sender_type as string | null,
    roomOwnerId: row.room_owner_id as string | null, roomOwnerName: row.room_owner_name as string | null, roomId: row.room_id as string | null,
    kind: row.kind as ArchiveMessage["kind"], question: row.question as string | null, answer: row.answer as string | null, source: row.source as CollectionSource, sourceFlags: Number(row.source_flags), parseStatus: row.parse_status as ArchiveMessage["parseStatus"],
    images: images.filter(image => image.message_id === row.id).map(image => ({ id: String(image.id), sourceUrl: String(image.source_url), galleryUrl: image.gallery_url as string | null, thumbnailUrl: image.thumbnail_url as string | null, width: image.width as number | null, height: image.height as number | null, status: image.status as "pending" | "uploaded" | "failed" })),
    videos: videos.filter(video => video.message_id === row.id).map(readVideo),
  }));
}
