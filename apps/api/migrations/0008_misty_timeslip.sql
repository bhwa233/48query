CREATE TABLE `query_collector_progress` (
	`since` text NOT NULL,
	`member_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`since`, `member_id`)
);
