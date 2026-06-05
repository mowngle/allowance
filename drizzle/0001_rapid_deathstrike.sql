-- Add device-level PIN verification timestamp.
-- (Drizzle also wanted to change families.payout_day default from 5 to 0,
--  but SQLite can't alter column defaults via ALTER TABLE. Skipped — the
--  seed script and new-family flow set payout_day explicitly anyway.)
ALTER TABLE `devices` ADD `parent_pin_verified_at` integer;
