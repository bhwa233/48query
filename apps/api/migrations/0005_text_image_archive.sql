CREATE TABLE `query_images` (
	`id` text PRIMARY KEY NOT NULL,
	`source_url` text NOT NULL,
	`gallery_url` text,
	`thumbnail_url` text,
	`width` integer,
	`height` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `query_message_images` (
	`message_id` text NOT NULL,
	`image_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`message_id`, `image_id`),
	FOREIGN KEY (`message_id`) REFERENCES `query_messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`image_id`) REFERENCES `query_images`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `query_source_sync` (
	`member_id` text NOT NULL,
	`source` text NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`member_id`, `source`)
);
--> statement-breakpoint
ALTER TABLE `query_messages` ADD `room_owner_id` text;--> statement-breakpoint
ALTER TABLE `query_messages` ADD `room_id` text;--> statement-breakpoint
ALTER TABLE `query_messages` ADD `kind` text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE `query_messages` ADD `question` text;--> statement-breakpoint
ALTER TABLE `query_messages` ADD `answer` text;--> statement-breakpoint
ALTER TABLE `query_messages` ADD `source` text DEFAULT 'room' NOT NULL;--> statement-breakpoint
ALTER TABLE `query_messages` ADD `source_flags` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `query_messages` ADD `parse_status` text DEFAULT 'parsed' NOT NULL;--> statement-breakpoint
CREATE INDEX `query_messages_author_time` ON `query_messages` (`member_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `query_messages_kind_time` ON `query_messages` (`kind`,`occurred_at`,`id`);