CREATE TABLE `chore_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`chore_id` text NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`marked_done_at` integer,
	`confirmed_at` integer,
	`confirmed_by` text,
	`rolled_from_id` text,
	FOREIGN KEY (`chore_id`) REFERENCES `chores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`confirmed_by`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `chores` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`assignee_id` text NOT NULL,
	`name` text NOT NULL,
	`photo_url` text,
	`recurrence` text NOT NULL,
	`expiry_rule` text DEFAULT 'vanish' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`person_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'unknown' NOT NULL,
	`first_claimed_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`cookie_token_hash` text NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `families` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`payout_day` integer DEFAULT 5 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`kid_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`description` text NOT NULL,
	`visible_to_kid` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	`related_payout_cycle_id` text,
	FOREIGN KEY (`kid_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`related_payout_cycle_id`) REFERENCES `payout_cycles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `payout_cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`kid_id` text NOT NULL,
	`week_starting` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`suggested_amount_cents` integer NOT NULL,
	`actual_amount_cents` integer,
	`reviewed_at` integer,
	`reviewed_by` text,
	`note` text,
	FOREIGN KEY (`kid_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `persons` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`birthdate` text,
	`avatar_url` text,
	`parent_pin_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chore_instances_due_idx` ON `chore_instances` (`due_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `chore_instances_chore_due_unique` ON `chore_instances` (`chore_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `chores_assignee_idx` ON `chores` (`assignee_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `devices_cookie_token_hash_unique` ON `devices` (`cookie_token_hash`);--> statement-breakpoint
CREATE INDEX `devices_person_idx` ON `devices` (`person_id`);--> statement-breakpoint
CREATE INDEX `ledger_entries_kid_idx` ON `ledger_entries` (`kid_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payout_cycles_kid_week_unique` ON `payout_cycles` (`kid_id`,`week_starting`);--> statement-breakpoint
CREATE INDEX `persons_family_idx` ON `persons` (`family_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);