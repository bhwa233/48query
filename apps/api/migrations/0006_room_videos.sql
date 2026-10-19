CREATE TABLE `query_message_videos` (
	`message_id` text NOT NULL,
	`video_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`message_id`, `video_id`),
	FOREIGN KEY (`message_id`) REFERENCES `query_messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`video_id`) REFERENCES `query_videos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `query_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`source_url` text NOT NULL,
	`gallery_url` text,
	`thumbnail_url` text,
	`bytes` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`skip_reason` text,
	`updated_at` text NOT NULL
);
