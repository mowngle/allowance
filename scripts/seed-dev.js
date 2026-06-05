// Populate dev.db with a fake family for local development.
// Idempotent: drops + recreates the test family on each run.

import 'dotenv/config';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import Database from 'better-sqlite3';

const url = process.env.DATABASE_URL || './dev.db';
console.log(`Seeding: ${url}`);
const db = new Database(url);
db.pragma('foreign_keys = ON');

const now = Date.now();

function uuid() {
  return randomUUID();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isoNDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function isoNYearsAgo(n) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
}

// Wipe any existing test family (cascade to all related rows).
const testFamilyName = 'Test Family';
db.prepare(`DELETE FROM families WHERE name = ?`).run(testFamilyName);

const familyId = uuid();
db.prepare(
  `INSERT INTO families (id, name, payout_day, created_at) VALUES (?, ?, ?, ?)`
).run(familyId, testFamilyName, 0, now); // 0 = Sunday review

// One parent, two kids.
const parentId = uuid();
db.prepare(
  `INSERT INTO persons (id, family_id, name, role, birthdate, parent_pin_hash, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
).run(parentId, familyId, 'Test Parent', 'parent', null, null, now);

const samId = uuid();
db.prepare(
  `INSERT INTO persons (id, family_id, name, role, birthdate, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`
).run(samId, familyId, 'Sam', 'kid', isoNYearsAgo(8), now);

const lilyId = uuid();
db.prepare(
  `INSERT INTO persons (id, family_id, name, role, birthdate, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`
).run(lilyId, familyId, 'Lily', 'kid', isoNYearsAgo(11), now);

// A few starter chores.
const insertChore = db.prepare(
  `INSERT INTO chores (id, family_id, assignee_id, name, recurrence, expiry_rule, active, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

insertChore.run(uuid(), familyId, samId, 'Make bed', JSON.stringify({ kind: 'daily' }), 'vanish', 1, now);
insertChore.run(uuid(), familyId, samId, 'Feed dog (morning)', JSON.stringify({ kind: 'daily' }), 'vanish', 1, now);
insertChore.run(uuid(), familyId, samId, 'Clean room', JSON.stringify({ kind: 'weekly', day: 6 }), 'roll_forward', 1, now);

insertChore.run(uuid(), familyId, lilyId, 'Make bed', JSON.stringify({ kind: 'daily' }), 'vanish', 1, now);
insertChore.run(uuid(), familyId, lilyId, 'Practice piano', JSON.stringify({ kind: 'weekdays' }), 'roll_forward', 1, now);
insertChore.run(uuid(), familyId, lilyId, 'Vacuum living room', JSON.stringify({ kind: 'weekly', day: 6 }), 'roll_forward', 1, now);

// A small starting balance for each kid, just so the UI has something to render.
const insertLedger = db.prepare(
  `INSERT INTO ledger_entries (id, kid_id, kind, amount_cents, description, visible_to_kid, created_at, created_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
insertLedger.run(uuid(), samId, 'payout', 800, "Last week's allowance", 1, now - 7 * 86400 * 1000, parentId);
insertLedger.run(uuid(), lilyId, 'payout', 1100, "Last week's allowance", 1, now - 7 * 86400 * 1000, parentId);

console.log(`Seeded family "${testFamilyName}":`);
console.log(`  Parent: Test Parent  (id: ${parentId})`);
console.log(`  Kid:    Sam (8yo)    (id: ${samId})`);
console.log(`  Kid:    Lily (11yo)  (id: ${lilyId})`);
console.log(`  Family id: ${familyId}`);

db.close();
