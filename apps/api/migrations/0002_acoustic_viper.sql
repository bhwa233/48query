CREATE TABLE `query_sync_state` (
	`member_id` text PRIMARY KEY NOT NULL,
	`message_cursor` text,
	`recording_cursor` text,
	`updated_at` text NOT NULL,
	`last_error` text
);
