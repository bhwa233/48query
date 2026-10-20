CREATE TABLE `query_catalog` (
	`member_id` text NOT NULL,
	`id` text NOT NULL,
	`source` text NOT NULL,
	`raw_json` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`member_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `query_catalog_pending` ON `query_catalog` (`member_id`,`source`,`status`,`updated_at`);