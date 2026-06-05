import { beforeAll, afterEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { rawDb } from '$lib/server/db';

beforeAll(() => {
  migrate(drizzle(rawDb), { migrationsFolder: './drizzle' });
});

afterEach(() => {
  const tables = rawDb
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`
    )
    .all() as { name: string }[];
  for (const t of tables) rawDb.prepare(`DELETE FROM "${t.name}"`).run();
});
