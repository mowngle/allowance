// Key-value access over the app_config table. Used for the cross-home scoreboard
// connection state (url, house id, token, friend code, house name).

import { eq } from 'drizzle-orm';
import { db, schema } from './db';

export async function getConfig(key: string): Promise<string | null> {
  const rows = await db
    .select({ value: schema.appConfig.value })
    .from(schema.appConfig)
    .where(eq(schema.appConfig.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

export async function setConfig(key: string, value: string): Promise<void> {
  db.insert(schema.appConfig)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appConfig.key, set: { value } })
    .run();
}

export async function deleteConfig(key: string): Promise<void> {
  db.delete(schema.appConfig).where(eq(schema.appConfig.key, key)).run();
}

export type ScoreboardCreds = { url: string; houseId: string; token: string };

/** The three values every authenticated scoreboard call needs, or null if not connected. */
export async function getScoreboardCreds(): Promise<ScoreboardCreds | null> {
  const [url, houseId, token] = await Promise.all([
    getConfig('scoreboard_url'),
    getConfig('scoreboard_house_id'),
    getConfig('scoreboard_token'),
  ]);
  if (!url || !houseId || !token) return null;
  return { url, houseId, token };
}
