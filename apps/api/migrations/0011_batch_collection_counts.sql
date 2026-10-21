CREATE TABLE `query_batch_items` (
	`batch_id` text NOT NULL,
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	PRIMARY KEY(`batch_id`, `kind`, `item_id`),
	FOREIGN KEY (`batch_id`) REFERENCES `query_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `query_batches` ADD `counts_tracked` integer DEFAULT false NOT NULL;