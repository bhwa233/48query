CREATE TABLE `query_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`stat_date` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`members_covered` integer DEFAULT 0 NOT NULL,
	`total_members` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`error_message` text
);
--> statement-breakpoint
CREATE TABLE `query_daily_stats` (
	`stat_date` text PRIMARY KEY NOT NULL,
	`messages` integer DEFAULT 0 NOT NULL,
	`active_members` integer DEFAULT 0 NOT NULL,
	`recordings` integer DEFAULT 0 NOT NULL,
	`danmaku` integer DEFAULT 0 NOT NULL,
	`type_breakdown_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `query_members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`pinyin` text,
	`group_name` text NOT NULL,
	`team` text,
	`room_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `query_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`type` text NOT NULL,
	`text` text,
	`sender_id` text,
	`sender_name` text,
	`sender_type` text,
	`source_json` text
);
--> statement-breakpoint
CREATE TABLE `query_recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`title` text,
	`occurred_at` text NOT NULL,
	`duration_seconds` integer,
	`danmaku_count` integer DEFAULT 0 NOT NULL,
	`danmaku_status` text DEFAULT 'pending' NOT NULL,
	`source_json` text
);
