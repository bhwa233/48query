CREATE TABLE `query_follower_snapshots` (
	`member_id` text NOT NULL,
	`observed_at` text NOT NULL,
	`followers` integer NOT NULL,
	PRIMARY KEY(`member_id`, `observed_at`),
	FOREIGN KEY (`member_id`) REFERENCES `query_members`(`id`) ON UPDATE no action ON DELETE no action
);
