ALTER TABLE `families` ADD `payout_mode` text DEFAULT 'age' NOT NULL;--> statement-breakpoint
ALTER TABLE `families` ADD `payout_cents_per_year` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `families` ADD `payout_bonus_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `families` ADD `payout_fixed_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `persons` ADD `payout_override` text;