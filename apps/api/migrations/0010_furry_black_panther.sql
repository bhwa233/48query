CREATE TABLE `query_melee_entries` (
	`snapshot_id` text NOT NULL,
	`member_id` text NOT NULL,
	`name` text NOT NULL,
	`rank` integer NOT NULL,
	`score` integer NOT NULL,
	PRIMARY KEY(`snapshot_id`, `member_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `query_melee_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `query_melee_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`period_id` integer NOT NULL,
	`period_label` text NOT NULL,
	`observed_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`next_cursor` text,
	`complete` integer DEFAULT false NOT NULL,
	`limited` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `query_melee_period_time` ON `query_melee_snapshots` (`period_id`,`observed_at`,`id`);