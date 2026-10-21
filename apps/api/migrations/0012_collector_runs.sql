CREATE TABLE `query_collector_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`stat_date` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`status` text NOT NULL,
	`total_members` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `query_collector_runs_started` ON `query_collector_runs` (`started_at`,`id`);--> statement-breakpoint
ALTER TABLE `query_batches` ADD `run_id` text REFERENCES query_collector_runs(id);--> statement-breakpoint
ALTER TABLE `query_batches` ADD `member_id` text;--> statement-breakpoint
ALTER TABLE `query_batches` ADD `phase` text;--> statement-breakpoint
CREATE INDEX `query_batches_run` ON `query_batches` (`run_id`,`id`);