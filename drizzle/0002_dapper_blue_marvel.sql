CREATE TABLE `app_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `persons` ADD `can_post_cheers` integer DEFAULT false NOT NULL;