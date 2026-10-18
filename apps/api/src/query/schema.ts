import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
});

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
