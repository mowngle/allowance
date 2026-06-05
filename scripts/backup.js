// One-shot manual backup. Run with: npm run db:backup

import 'dotenv/config';
import { mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';

const url = process.env.DATABASE_URL || './dev.db';
const dir = resolve('./backups');
mkdirSync(dir, { recursive: true });

const db = new Database(url, { readonly: true });

const tableNames = db
  .prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`
  )
  .all()
  .map((r) => r.name);

const data = {};
const counts = {};
for (const t of tableNames) {
  const rows = db.prepare(`SELECT * FROM "${t}"`).all();
  data[t] = rows;
  counts[t] = rows.length;
}

const payload = {
  version: 1,
  exportedAt: new Date().toISOString(),
  counts,
  data,
};

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const path = join(dir, `allowance-${stamp}.json`);
writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8');

console.log(`Wrote ${path}`);
console.log('Row counts:');
for (const [t, n] of Object.entries(counts)) console.log(`  ${t}: ${n}`);

// Rotate beyond 30 days.
const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
for (const name of readdirSync(dir)) {
  if (!name.startsWith('allowance-') || !name.endsWith('.json')) continue;
  const p = join(dir, name);
  if (statSync(p).mtimeMs < cutoffMs) {
    unlinkSync(p);
    console.log(`Rotated: ${name}`);
  }
}

db.close();
