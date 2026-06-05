// Apply Drizzle-generated migrations to the SQLite database.
// Reads DATABASE_URL (defaults to ./dev.db) and applies any pending
// migrations from ./drizzle/.

import 'dotenv/config';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const url = process.env.DATABASE_URL || './dev.db';
console.log(`Applying migrations to: ${url}`);

const sqlite = new Database(url);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite);

migrate(db, { migrationsFolder: './drizzle' });

console.log('Migrations applied.');
sqlite.close();
