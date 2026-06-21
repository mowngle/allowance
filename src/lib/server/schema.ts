// Drizzle schema for the allowance app.
//
// Conventions:
// - All IDs are text UUIDs (generated in app code via crypto.randomUUID()).
// - All timestamps are integer Unix epoch milliseconds.
// - All dates without a time component (birthdate, due_date, week_starting) are
//   ISO date strings (YYYY-MM-DD).
// - All monetary amounts are integer cents (avoid float math).
// - The ledger is append-only; a kid's balance is the sum of amount_cents
//   for that kid's entries. Reversals are new entries with negative amounts.

import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ─── Families ────────────────────────────────────────────────────────────────

export const families = sqliteTable('families', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  // 0=Sunday … 5=Friday … 6=Saturday. Default Sunday — review happens at the
  // end of the responsibility week, before the new week begins.
  payoutDay: integer('payout_day').notNull().default(0),
  // Payout scheme for the family (default reproduces the original "age in dollars").
  payoutMode: text('payout_mode', { enum: ['age', 'fixed'] }).notNull().default('age'),
  payoutCentsPerYear: integer('payout_cents_per_year').notNull().default(100),
  payoutBonusCents: integer('payout_bonus_cents').notNull().default(0),
  payoutFixedCents: integer('payout_fixed_cents').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

// ─── Persons (parents + kids) ────────────────────────────────────────────────

export const persons = sqliteTable(
  'persons',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role', { enum: ['parent', 'kid'] }).notNull(),
    // ISO date 'YYYY-MM-DD'. Nullable for parents.
    birthdate: text('birthdate'),
    avatarUrl: text('avatar_url'),
    // Per-kid: may this kid post canned cheers to the cross-home wall? Default off.
    canPostCheers: integer('can_post_cheers', { mode: 'boolean' }).notNull().default(false),
    // Per-kid payout override (JSON: {mode,centsPerYear,bonusCents,fixedCents}); null = inherit family.
    payoutOverride: text('payout_override'),
    // Argon2/bcrypt hash. Nullable; only parents have a PIN.
    parentPinHash: text('parent_pin_hash'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    familyIdx: index('persons_family_idx').on(t.familyId),
  })
);

// ─── Chores ──────────────────────────────────────────────────────────────────

// Recurrence is a small JSON blob. Keep flexible without proliferating columns.
// Examples:
//   { kind: 'daily' }
//   { kind: 'weekly', day: 6 }  // 0=Sun … 6=Sat
//   { kind: 'weekdays' }
//   { kind: 'by-end-of-week' }  // anytime this week; due Sat
//
// expiryRule:
//   'vanish'       — undone instance is dropped at end of its period
//   'roll_forward' — undone instance shows up the next day as "late"

export const chores = sqliteTable(
  'chores',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    assigneeId: text('assignee_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    photoUrl: text('photo_url'),
    recurrence: text('recurrence').notNull(), // JSON
    expiryRule: text('expiry_rule', { enum: ['vanish', 'roll_forward'] })
      .notNull()
      .default('vanish'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    assigneeIdx: index('chores_assignee_idx').on(t.assigneeId),
  })
);

// ─── Chore Instances ─────────────────────────────────────────────────────────
//
// A chore instance is a materialization of a chore for a specific day.
// Generated nightly (or on demand) from the chore's recurrence.
//
// Status flow:
//   pending   → kid hasn't marked it
//   done      → kid marked it; awaiting parent confirmation
//   confirmed → parent confirmed (counts toward weekly responsibility)
//   disputed  → parent rejected the kid's mark
//
// rolledFromId points to the prior day's instance if this one is a roll-forward
// of an undone chore. We never "edit" instances backward; we materialize new ones.

export const choreInstances = sqliteTable(
  'chore_instances',
  {
    id: text('id').primaryKey(),
    choreId: text('chore_id')
      .notNull()
      .references(() => chores.id, { onDelete: 'cascade' }),
    dueDate: text('due_date').notNull(), // 'YYYY-MM-DD'
    status: text('status', { enum: ['pending', 'done', 'confirmed', 'disputed'] })
      .notNull()
      .default('pending'),
    markedDoneAt: integer('marked_done_at'),
    confirmedAt: integer('confirmed_at'),
    confirmedBy: text('confirmed_by').references(() => persons.id),
    rolledFromId: text('rolled_from_id'),
  },
  (t) => ({
    dueIdx: index('chore_instances_due_idx').on(t.dueDate),
    choreDueUniq: uniqueIndex('chore_instances_chore_due_unique').on(t.choreId, t.dueDate),
  })
);

// ─── Payout Cycles ───────────────────────────────────────────────────────────
//
// One row per kid per week. Created when the week opens (or on demand).
// week_starting is the ISO date of the cycle's Sunday (or family's chosen anchor).
//
// status:
//   open      — week in progress
//   reviewed  — parent has decided amount but hasn't paid
//   paid      — ledger entry created
//   skipped   — parent chose to skip; no ledger entry

export const payoutCycles = sqliteTable(
  'payout_cycles',
  {
    id: text('id').primaryKey(),
    kidId: text('kid_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    weekStarting: text('week_starting').notNull(), // 'YYYY-MM-DD'
    status: text('status', { enum: ['open', 'reviewed', 'paid', 'skipped'] })
      .notNull()
      .default('open'),
    suggestedAmountCents: integer('suggested_amount_cents').notNull(),
    actualAmountCents: integer('actual_amount_cents'),
    reviewedAt: integer('reviewed_at'),
    reviewedBy: text('reviewed_by').references(() => persons.id),
    note: text('note'),
  },
  (t) => ({
    kidWeekUniq: uniqueIndex('payout_cycles_kid_week_unique').on(t.kidId, t.weekStarting),
  })
);

// ─── Ledger Entries ──────────────────────────────────────────────────────────
//
// Append-only. Balance = sum of amountCents for a kid.
// amountCents is signed: +800 for a payout, -1500 for a debit, etc.
// description is required and visible to the kid (unless visibleToKid is false).

export const ledgerEntries = sqliteTable(
  'ledger_entries',
  {
    id: text('id').primaryKey(),
    kidId: text('kid_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['payout', 'debit', 'adjustment'] }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    description: text('description').notNull(),
    visibleToKid: integer('visible_to_kid', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    createdBy: text('created_by').references(() => persons.id),
    relatedPayoutCycleId: text('related_payout_cycle_id').references(() => payoutCycles.id),
  },
  (t) => ({
    kidIdx: index('ledger_entries_kid_idx').on(t.kidId),
  })
);

// ─── Devices ─────────────────────────────────────────────────────────────────
//
// Each parent phone / kid tablet that has claimed the app.
// cookieTokenHash is SHA-256 of the session cookie; the cookie itself never
// leaves the client. Look up devices by hashing the presented cookie.

export const devices = sqliteTable(
  'devices',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    personId: text('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['phone', 'tablet', 'desktop', 'unknown'] })
      .notNull()
      .default('unknown'),
    firstClaimedAt: integer('first_claimed_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    cookieTokenHash: text('cookie_token_hash').notNull().unique(),
    // Last time the parent successfully entered their PIN on this device.
    // Null for kid devices and for parents who haven't set a PIN.
    parentPinVerifiedAt: integer('parent_pin_verified_at'),
  },
  (t) => ({
    personIdx: index('devices_person_idx').on(t.personId),
  })
);

// ─── Push Subscriptions ──────────────────────────────────────────────────────
//
// Parent phones only (kid tablets use the wrapper APK's local notifications).
// Multiple subscriptions per device aren't expected; we replace on conflict.

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: text('id').primaryKey(),
  deviceId: text('device_id')
    .notNull()
    .references(() => devices.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: integer('created_at').notNull(),
});

// ─── App Config ──────────────────────────────────────────────────────────────
//
// Small key-value store for runtime-acquired settings that aren't secrets-in-.env
// — currently the cross-home scoreboard connection (url, house id, token, friend
// code). Included in the nightly JSON backup like every other table.

export const appConfig = sqliteTable('app_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ─── Type exports ────────────────────────────────────────────────────────────

export type Family = typeof families.$inferSelect;
export type Person = typeof persons.$inferSelect;
export type Chore = typeof chores.$inferSelect;
export type ChoreInstance = typeof choreInstances.$inferSelect;
export type PayoutCycle = typeof payoutCycles.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type AppConfig = typeof appConfig.$inferSelect;
