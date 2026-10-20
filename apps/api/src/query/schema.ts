import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const queryMembers = sqliteTable("query_members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  pinyin: text("pinyin"),
  groupName: text("group_name").notNull(),
  team: text("team"),
  roomId: text("room_id"),
  channelId: text("channel_id"),
  serverId: text("server_id"),
  liveRoomId: text("live_room_id"),
  status: text("status").notNull().default("active"),
  updatedAt: text("updated_at").notNull(),
});

export const queryFollowerSnapshots = sqliteTable("query_follower_snapshots", {
  memberId: text("member_id").notNull().references(() => queryMembers.id),
  observedAt: text("observed_at").notNull(),
  followers: integer("followers").notNull(),
}, table => [primaryKey({ columns: [table.memberId, table.observedAt] })]);

export const queryMeleeSnapshots = sqliteTable("query_melee_snapshots", {
  id: text("id").primaryKey(), periodId: integer("period_id").notNull(), periodLabel: text("period_label").notNull(),
  observedAt: text("observed_at").notNull(), updatedAt: text("updated_at").notNull(),
  nextCursor: text("next_cursor"), complete: integer("complete", { mode: "boolean" }).notNull().default(false),
  limited: integer("limited", { mode: "boolean" }).notNull().default(false),
}, table => [index("query_melee_period_time").on(table.periodId, table.observedAt, table.id)]);

export const queryMeleeEntries = sqliteTable("query_melee_entries", {
  snapshotId: text("snapshot_id").notNull().references(() => queryMeleeSnapshots.id),
  memberId: text("member_id").notNull(), name: text("name").notNull(), rank: integer("rank").notNull(), score: integer("score").notNull(),
}, table => [primaryKey({ columns: [table.snapshotId, table.memberId] })]);

export const queryMessages = sqliteTable("query_messages", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull(),
  occurredAt: text("occurred_at").notNull(),
  type: text("type").notNull(),
  text: text("text"),
  senderId: text("sender_id"),
  senderName: text("sender_name"),
  senderType: text("sender_type"),
  sourceJson: text("source_json"),
  roomOwnerId: text("room_owner_id"),
  roomId: text("room_id"),
  kind: text("kind").notNull().default("text"),
  question: text("question"),
  answer: text("answer"),
  source: text("source").notNull().default("room"),
  sourceFlags: integer("source_flags").notNull().default(1),
  parseStatus: text("parse_status").notNull().default("parsed"),
}, table => [index("query_messages_author_time").on(table.memberId, table.occurredAt, table.id), index("query_messages_kind_time").on(table.kind, table.occurredAt, table.id)]);

export const queryImages = sqliteTable("query_images", {
  id: text("id").primaryKey(), sourceUrl: text("source_url").notNull(), galleryUrl: text("gallery_url"), thumbnailUrl: text("thumbnail_url"),
  width: integer("width"), height: integer("height"), status: text("status").notNull().default("pending"), updatedAt: text("updated_at").notNull(),
});
export const queryMessageImages = sqliteTable("query_message_images", {
  messageId: text("message_id").notNull().references(() => queryMessages.id), imageId: text("image_id").notNull().references(() => queryImages.id), position: integer("position").notNull(),
}, table => [primaryKey({ columns: [table.messageId, table.imageId] })]);
export const queryVideos = sqliteTable("query_videos", {
  id: text("id").primaryKey(), sourceUrl: text("source_url").notNull(), galleryUrl: text("gallery_url"), thumbnailUrl: text("thumbnail_url"),
  bytes: integer("bytes"), status: text("status").notNull().default("pending"), skipReason: text("skip_reason"), updatedAt: text("updated_at").notNull(),
});
export const queryMessageVideos = sqliteTable("query_message_videos", {
  messageId: text("message_id").notNull().references(() => queryMessages.id), videoId: text("video_id").notNull().references(() => queryVideos.id), position: integer("position").notNull(),
}, table => [primaryKey({ columns: [table.messageId, table.videoId] })]);
export const querySourceSync = sqliteTable("query_source_sync", {
  memberId: text("member_id").notNull(), source: text("source").notNull(), stateJson: text("state_json").notNull(), updatedAt: text("updated_at").notNull(),
}, table => [primaryKey({ columns: [table.memberId, table.source] })]);

export const queryCollectorProgress = sqliteTable("query_collector_progress", {
  since: text("since").notNull(), memberId: text("member_id").notNull(),
  revision: integer("revision").notNull(), stateJson: text("state_json").notNull(), updatedAt: text("updated_at").notNull(),
}, table => [primaryKey({ columns: [table.since, table.memberId] })]);

export const queryRecordings = sqliteTable("query_recordings", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull(),
  title: text("title"),
  occurredAt: text("occurred_at").notNull(),
  durationSeconds: integer("duration_seconds"),
  danmakuCount: integer("danmaku_count").notNull().default(0),
  danmakuStatus: text("danmaku_status").notNull().default("pending"),
  sourceJson: text("source_json"),
});

export const queryDailyStats = sqliteTable("query_daily_stats", {
  statDate: text("stat_date").primaryKey(),
  messages: integer("messages").notNull().default(0),
  activeMembers: integer("active_members").notNull().default(0),
  recordings: integer("recordings").notNull().default(0),
  danmaku: integer("danmaku").notNull().default(0),
  typeBreakdownJson: text("type_breakdown_json").notNull().default("[]"),
  updatedAt: text("updated_at").notNull(),
});

export const queryBatches = sqliteTable("query_batches", {
  id: text("id").primaryKey(),
  statDate: text("stat_date").notNull(),
  status: text("status").notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  membersCovered: integer("members_covered").notNull().default(0),
  totalMembers: integer("total_members").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  errorMessage: text("error_message"),
});

export const querySyncState = sqliteTable("query_sync_state", {
  memberId: text("member_id").primaryKey(),
  messageCursor: text("message_cursor"),
  recordingCursor: text("recording_cursor"),
  updatedAt: text("updated_at").notNull(),
  lastError: text("last_error"),
});

// Unattributed catalog rows stay private until an original message verifies them.
export const queryCatalog = sqliteTable("query_catalog", {
  memberId: text("member_id").notNull(), id: text("id").notNull(), source: text("source").notNull(),
  rawJson: text("raw_json").notNull(), status: text("status").notNull(), updatedAt: text("updated_at").notNull(),
}, table => [primaryKey({ columns: [table.memberId, table.id] }), index("query_catalog_pending").on(table.memberId, table.source, table.status, table.updatedAt)]);
