import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { seedFamily, seedKid } from './test/seed';
import { db, schema } from './db';
import { eq } from 'drizzle-orm';
import { setConfig } from './config';
import { isSetupComplete } from './setup';

describe('persons.active column', () => {
  it('defaults to true for a newly inserted person', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    const rows = await db
      .select({ active: schema.persons.active })
      .from(schema.persons)
      .where(eq(schema.persons.id, kid));
    expect(rows[0].active).toBe(true);
  });
});

describe('isSetupComplete marker', () => {
  it('is false with no marker and true once the marker is set', async () => {
    expect(await isSetupComplete()).toBe(false);
    await setConfig('setup_completed', '1');
    expect(await isSetupComplete()).toBe(true);
  });
});

describe('0004 backfill SQL', () => {
  const BACKFILL =
    `INSERT OR IGNORE INTO app_config (key, value) SELECT 'setup_completed', '1' WHERE EXISTS (SELECT 1 FROM persons WHERE role = 'parent');`;
  function freshDb() {
    const s = new Database(':memory:');
    s.exec(`CREATE TABLE persons (id text primary key, role text);`);
    s.exec(`CREATE TABLE app_config (key text primary key, value text);`);
    return s;
  }
  it('sets the marker when a parent exists', () => {
    const s = freshDb();
    s.exec(`INSERT INTO persons (id, role) VALUES ('p1','parent');`);
    s.exec(BACKFILL);
    const row = s.prepare(`SELECT value FROM app_config WHERE key='setup_completed'`).get() as { value: string } | undefined;
    expect(row?.value).toBe('1');
    s.close();
  });
  it('does nothing when no parent exists', () => {
    const s = freshDb();
    s.exec(BACKFILL);
    const row = s.prepare(`SELECT value FROM app_config WHERE key='setup_completed'`).get();
    expect(row).toBeUndefined();
    s.close();
  });
});
