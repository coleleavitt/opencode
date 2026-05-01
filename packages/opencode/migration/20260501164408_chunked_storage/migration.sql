CREATE TABLE `blob` (
	`hash` text PRIMARY KEY,
	`size` integer NOT NULL,
	`data` blob NOT NULL
);
--> statement-breakpoint
ALTER TABLE `part` ADD `blob_hash` text;--> statement-breakpoint
CREATE INDEX `part_session_time_id_idx` ON `part` (`session_id`,`time_created`,`id`);