// Single source of truth for the SQLite database connection.
//
// Uses better-sqlite3 (synchronous, fast, embedded). DATABASE_URL points to a
// file path; default is ./dev.db in the project root.

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const url = process.env.DATABASE_URL || './dev.db';
const sqlite = new Database(url);

// WAL mode for better concurrency; foreign keys on.
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { schema };
export const rawDb = sqlite;
