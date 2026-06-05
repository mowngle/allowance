// Nightly JSON snapshot of the entire database.
//
// On a family-scale dataset this is trivial — a single JSON file under
// 1 MB even after years of use. Survives DB corruption and gives us a
// human-readable audit trail.
//
// The same module also schedules a daily run (3am local) when imported in the
// server runtime, with a module-level guard so SvelteKit's hot-reload doesn't
// create duplicate timers.

import { mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { rawDb } from './db';

const BACKUP_DIR = resolve('./backups');
const RETENTION_DAYS = 30;

export type BackupResult = {
  path: string;
  bytes: number;
  tables: Record<string, number>;
};

export function exportAllToJson(dir = BACKUP_DIR): BackupResult {
  mkdirSync(dir, { recursive: true });

  const tableNames: string[] = rawDb
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`)
    .all()
    .map((r: any) => r.name as string);

  const data: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  for (const t of tableNames) {
    const rows = rawDb.prepare(`SELECT * FROM "${t}"`).all();
    data[t] = rows as any[];
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
  const json = JSON.stringify(payload, null, 2);
  writeFileSync(path, json, 'utf8');

  rotateOld(dir);

  return { path, bytes: Buffer.byteLength(json, 'utf8'), tables: counts };
}

function rotateOld(dir: string): void {
  try {
    const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith('allowance-') || !name.endsWith('.json')) continue;
      const p = join(dir, name);
      const stat = statSync(p);
      if (stat.mtimeMs < cutoffMs) unlinkSync(p);
    }
  } catch (e) {
    console.error('[backup] rotation failed:', e);
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

// Guard against SvelteKit dev hot-reload creating multiple timers.
// `globalThis` survives module reloads in Vite's HMR.
const GLOBAL_KEY = Symbol.for('allowance.backup.scheduler');
declare global {
  // eslint-disable-next-line no-var
  var __allowanceBackupScheduler__: { timer: NodeJS.Timeout | null } | undefined;
}

function msUntilNext3am(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function scheduleNightlyBackup(): void {
  const existing = (globalThis as any).__allowanceBackupScheduler__;
  if (existing?.timer) {
    clearTimeout(existing.timer);
  }
  const state = { timer: null as NodeJS.Timeout | null };
  (globalThis as any).__allowanceBackupScheduler__ = state;

  function arm() {
    state.timer = setTimeout(() => {
      try {
        const r = exportAllToJson();
        console.log(`[backup] wrote ${r.path} (${r.bytes} bytes)`);
      } catch (e) {
        console.error('[backup] nightly export failed:', e);
      }
      arm(); // reschedule for next day
    }, msUntilNext3am());
  }
  arm();
  console.log(
    `[backup] scheduler armed; next run in ${Math.round(msUntilNext3am() / 1000 / 60)} min`
  );
}
