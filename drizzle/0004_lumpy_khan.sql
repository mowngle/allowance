ALTER TABLE `persons` ADD `active` integer DEFAULT true NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `app_config` (`key`, `value`) SELECT 'setup_completed', '1' WHERE EXISTS (SELECT 1 FROM `persons` WHERE `role` = 'parent');