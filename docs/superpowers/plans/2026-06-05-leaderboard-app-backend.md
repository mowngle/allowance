# Leaderboard App Integration — Backend Foundation Plan (2a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the app-side backend for the cross-home leaderboard — a config store, the fair-scoring engine (consistency %, streak, badges), and a typed client for the Scoreboard Worker — all unit-tested.

**Architecture:** Pure additions to the existing SvelteKit app. A new `app_config` SQLite table holds the scoreboard connection state. `leaderboard.ts` computes each kid's summary from existing chore data (reusing `getCurrentWeekReview`). `scoreboard.ts` wraps the Worker's HTTP API, reading credentials from config. No existing behavior changes. The UI that consumes these lands in the follow-up plan (2b).

**Tech Stack:** SvelteKit (Node adapter), better-sqlite3 + Drizzle ORM, drizzle-kit migrations, Vitest (new to this repo) with an in-memory SQLite harness.

**Reference spec:** `docs/superpowers/specs/2026-06-05-cross-home-leaderboard-design.md` (§3 scoring, §4 summary, §6 badges).
**Worker contract:** `docs/superpowers/plans/2026-06-05-scoreboard-worker.md` (HTTP API table at top).

---

## Context the implementer needs

- **Session:** `event.locals.session` = `{ personId, role: 'parent'|'kid', familyId, deviceId, personName } | null` (see `src/app.d.ts`, `src/hooks.server.ts`).
- **DB singleton:** `src/lib/server/db.ts` exports `db` (Drizzle) and `rawDb` (better-sqlite3), opened from `process.env.DATABASE_URL || './dev.db'` at import time. All server modules import `{ db, schema }` from `./db`.
- **Existing scoring inputs:**
  - `getCurrentWeekReview(familyId)` in `src/lib/server/payouts.ts` returns, per kid: `{ kidId, kidName, age, weekStarting, confirmedCount, totalCount, ... }` where `confirmedCount` already includes kid-marked-`done` instances (the "kid did their part" count).
  - `chore_instances.status` ∈ `pending | done | confirmed | disputed`. A "miss" = `pending` or `disputed` past its due date.
  - Dates: `src/lib/server/dates.ts` exports `todayIso()`, `isoDaysAgo(n)`, `weekStarting(iso)`.
- **Migrations:** edit `src/lib/server/schema.ts`, run `npm run db:generate` (drizzle-kit writes `drizzle/NNNN_*.sql`), apply with `npm run db:migrate`.
- **No test tooling exists yet** — Task 1 adds Vitest.
- **Money never leaves the house** and is never part of any summary (spec §3).

### Config keys (in the new `app_config` table)
| key | value |
|-----|-------|
| `scoreboard_url` | Base URL of the deployed Worker (e.g. `https://allowance-scoreboard.x.workers.dev`) |
| `scoreboard_house_id` | This house's id, from `/register` |
| `scoreboard_token` | This house's bearer token, from `/register` |
| `scoreboard_friend_code` | This house's shareable code, from `/register` |
| `scoreboard_house_name` | The name registered (for display) |

---

## File Structure

```
src/lib/server/
  schema.ts            # MODIFY: add app_config table + persons.canPostCheers column
  config.ts            # NEW: typed get/set/delete over app_config
  leaderboard.ts       # NEW: scoring (consistency %, streak, badges) + buildLocalSummary
  scoreboard.ts        # NEW: HTTP client for the Worker (register, push, board, cheer, links)
  test/
    setup.ts           # NEW: vitest setup — in-memory DB + migrations + per-test wipe
    seed.ts            # NEW: test seed helpers (family, kid, chore, instances, config)
  config.test.ts       # NEW
  leaderboard.test.ts  # NEW
  scoreboard.test.ts   # NEW
drizzle/NNNN_*.sql     # NEW: generated migration
vitest.config.ts       # NEW (repo root)
package.json           # MODIFY: add vitest dep + test scripts
```

---

## Task 1: Schema migration — `app_config` table + `persons.canPostCheers`

**Files:**
- Modify: `src/lib/server/schema.ts`
- Generate: `drizzle/NNNN_*.sql`
- Apply to: `dev.db`

- [ ] **Step 1: Add the `app_config` table to `schema.ts`**

After the `pushSubscriptions` table definition (before the `// ─── Type exports ───` block), add:

```ts
// ─── App Config ──────────────────────────────────────────────────────────────
//
// Small key-value store for runtime-acquired settings that aren't secrets-in-.env
// — currently the cross-home scoreboard connection (url, house id, token, friend
// code). Included in the nightly JSON backup like every other table.

export const appConfig = sqliteTable('app_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
```

- [ ] **Step 2: Add the `canPostCheers` column to `persons`**

In the `persons` table definition, add this column after `avatarUrl`:

```ts
    // Per-kid: may this kid post canned cheers to the cross-home wall? Default off.
    canPostCheers: integer('can_post_cheers', { mode: 'boolean' }).notNull().default(false),
```

- [ ] **Step 3: Add the type export**

In the `// ─── Type exports ───` block, add:

```ts
export type AppConfig = typeof appConfig.$inferSelect;
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: drizzle-kit prints that it created a new file `drizzle/0002_*.sql`. Open it and confirm it contains a `CREATE TABLE \`app_config\`` and an `ALTER TABLE \`persons\` ADD \`can_post_cheers\``.

- [ ] **Step 5: Apply the migration to dev.db**

Run: `npm run db:migrate`
Expected: prints "Migrations applied."

- [ ] **Step 6: Verify the schema changed**

Run: `node -e "const D=require('better-sqlite3'); const db=new D('./dev.db'); console.log(db.prepare('PRAGMA table_info(persons)').all().map(c=>c.name).join(',')); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='app_config'\").all());"`
Expected: the persons columns list includes `can_post_cheers`, and `app_config` is listed as a table.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/schema.ts drizzle/
git commit -m "feat(db): add app_config table and persons.can_post_cheers"
```

---

## Task 2: Vitest harness + seed helpers

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/server/test/setup.ts`
- Create: `src/lib/server/test/seed.ts`
- Test: `src/lib/server/test/setup.smoke.test.ts`

- [ ] **Step 1: Add Vitest to `package.json`**

Add to `devDependencies`: `"vitest": "^2.0.5"`. Add to `scripts`:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: vitest added under node_modules.

- [ ] **Step 3: Create `vitest.config.ts`** (repo root)

The `env.DATABASE_URL = ':memory:'` is set here so it applies BEFORE any module (including `db.ts`) is imported — an in-memory DB per test file. The `$lib` alias mirrors `svelte.config.js`.

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    env: { DATABASE_URL: ':memory:' },
    setupFiles: ['./src/lib/server/test/setup.ts'],
    // server modules share a singleton DB connection; run test files in one fork
    // so the in-memory DB is consistent within a file.
    pool: 'forks',
  },
  resolve: {
    alias: { $lib: resolve('./src/lib') },
  },
});
```

- [ ] **Step 4: Create `src/lib/server/test/setup.ts`**

Applies migrations to the in-memory DB once per test file, and wipes all rows between tests for isolation.

```ts
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
```

- [ ] **Step 5: Create `src/lib/server/test/seed.ts`**

Reusable builders for scoring tests. Uses the same `db`/`schema` the production code uses.

```ts
import { db, schema } from '$lib/server/db';

export function seedFamily(name = 'Test Fam'): string {
  const id = crypto.randomUUID();
  db.insert(schema.families).values({ id, name, payoutDay: 0, createdAt: Date.now() }).run();
  return id;
}

export function seedKid(familyId: string, name: string, birthdate = '2016-01-01'): string {
  const id = crypto.randomUUID();
  db.insert(schema.persons)
    .values({ id, familyId, name, role: 'kid', birthdate, createdAt: Date.now() })
    .run();
  return id;
}

export function seedChore(familyId: string, assigneeId: string, name = 'Chore'): string {
  const id = crypto.randomUUID();
  db.insert(schema.chores)
    .values({
      id,
      familyId,
      assigneeId,
      name,
      recurrence: JSON.stringify({ kind: 'daily' }),
      expiryRule: 'vanish',
      active: true,
      createdAt: Date.now(),
    })
    .run();
  return id;
}

/** Create one chore instance for a chore on a given day with a given status. */
export function seedInstance(
  choreId: string,
  dueDate: string,
  status: 'pending' | 'done' | 'confirmed' | 'disputed',
  markedDoneAt: number | null = null
): string {
  const id = crypto.randomUUID();
  db.insert(schema.choreInstances)
    .values({ id, choreId, dueDate, status, markedDoneAt: markedDoneAt ?? undefined })
    .run();
  return id;
}
```

- [ ] **Step 6: Create the smoke test `src/lib/server/test/setup.smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/server/db';
import { seedFamily, seedKid } from './seed';

describe('test harness', () => {
  it('has a migrated in-memory DB and isolates rows per test', () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    const kids = db.select().from(schema.persons).all();
    expect(kids).toHaveLength(1);
    expect(kids[0].id).toBe(kid);
    expect(kids[0].canPostCheers).toBe(false); // column from Task 1 migration exists
  });

  it('starts empty (previous test wiped)', () => {
    expect(db.select().from(schema.persons).all()).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Run the smoke test**

Run: `npm test -- setup.smoke`
Expected: PASS (2 tests). This proves migrations apply to the in-memory DB and `canPostCheers` exists.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/server/test/
git commit -m "test: add vitest harness with in-memory migrated DB and seed helpers"
```

---

## Task 3: `config.ts` — app_config accessor

**Files:**
- Create: `src/lib/server/config.ts`
- Test: `src/lib/server/config.test.ts`

- [ ] **Step 1: Write the failing test `src/lib/server/config.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { getConfig, setConfig, deleteConfig, getScoreboardCreds } from './config';

describe('config', () => {
  it('returns null for an unset key', async () => {
    expect(await getConfig('scoreboard_url')).toBeNull();
  });

  it('sets then gets a value, and upserts on repeat', async () => {
    await setConfig('scoreboard_url', 'https://a.test');
    expect(await getConfig('scoreboard_url')).toBe('https://a.test');
    await setConfig('scoreboard_url', 'https://b.test');
    expect(await getConfig('scoreboard_url')).toBe('https://b.test');
  });

  it('deletes a key', async () => {
    await setConfig('scoreboard_token', 'abc');
    await deleteConfig('scoreboard_token');
    expect(await getConfig('scoreboard_token')).toBeNull();
  });

  it('getScoreboardCreds returns null until url, house id, and token are all set', async () => {
    expect(await getScoreboardCreds()).toBeNull();
    await setConfig('scoreboard_url', 'https://a.test');
    await setConfig('scoreboard_house_id', 'h_1');
    expect(await getScoreboardCreds()).toBeNull(); // token missing
    await setConfig('scoreboard_token', 'tok');
    expect(await getScoreboardCreds()).toEqual({
      url: 'https://a.test',
      houseId: 'h_1',
      token: 'tok',
    });
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm test -- config`
Expected: FAIL — `./config` does not exist.

- [ ] **Step 3: Create `src/lib/server/config.ts`**

```ts
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
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npm test -- config`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/config.ts src/lib/server/config.test.ts
git commit -m "feat(app): app_config accessor and scoreboard creds helper"
```

---

## Task 4: `leaderboard.ts` — scoring engine

Computes the per-kid summary that gets pushed to the Worker. Reuses `getCurrentWeekReview` for the consistency numerator/denominator; adds streak + badges.

**Files:**
- Create: `src/lib/server/leaderboard.ts`
- Test: `src/lib/server/leaderboard.test.ts`

- [ ] **Step 1: Write the failing test `src/lib/server/leaderboard.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { todayIso, isoDaysAgo } from './dates';
import { streakForKid, badgesForKid, buildLocalSummary } from './leaderboard';
import { seedFamily, seedKid, seedChore, seedInstance } from './test/seed';

describe('streakForKid', () => {
  it('counts consecutive past days with all chores done', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    const chore = seedChore(fam, kid);
    // yesterday, 2 days ago, 3 days ago all confirmed → streak 3
    seedInstance(chore, isoDaysAgo(1), 'confirmed');
    seedInstance(chore, isoDaysAgo(2), 'done');
    seedInstance(chore, isoDaysAgo(3), 'confirmed');
    expect(await streakForKid(kid)).toBe(3);
  });

  it('breaks the streak on a past missed day', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    const chore = seedChore(fam, kid);
    seedInstance(chore, isoDaysAgo(1), 'confirmed');
    seedInstance(chore, isoDaysAgo(2), 'pending'); // missed
    seedInstance(chore, isoDaysAgo(3), 'confirmed');
    expect(await streakForKid(kid)).toBe(1);
  });

  it('treats a no-chore day as neutral (does not break)', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    const chore = seedChore(fam, kid);
    seedInstance(chore, isoDaysAgo(1), 'confirmed');
    // nothing on day 2 (neutral)
    seedInstance(chore, isoDaysAgo(3), 'confirmed');
    expect(await streakForKid(kid)).toBe(2);
  });

  it("today's still-pending chore does not break the streak", async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    const chore = seedChore(fam, kid);
    seedInstance(chore, todayIso(), 'pending'); // day not over
    seedInstance(chore, isoDaysAgo(1), 'confirmed');
    expect(await streakForKid(kid)).toBe(1);
  });
});

describe('badgesForKid', () => {
  it('awards perfect-week at 100% and iron-streak at >=14', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    const chore = seedChore(fam, kid);
    for (let d = 1; d <= 16; d++) seedInstance(chore, isoDaysAgo(d), 'confirmed');
    const badges = await badgesForKid(kid, 100);
    expect(badges).toContain('perfect-week');
    expect(badges).toContain('iron-streak');
  });

  it('awards dawn-patrol when each of the last 5 days had a pre-8am completion', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    const chore = seedChore(fam, kid);
    for (let d = 0; d < 5; d++) {
      const day = isoDaysAgo(d);
      const at = new Date(`${day}T06:30:00`).getTime(); // 6:30am local
      seedInstance(chore, day, 'confirmed', at);
    }
    expect(await badgesForKid(kid, 50)).toContain('dawn-patrol');
  });

  it('no badges for a middling week', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    expect(await badgesForKid(kid, 60)).toEqual([]);
  });
});

describe('buildLocalSummary', () => {
  it('produces house name, weekStarting, and a kid with pct + streak', async () => {
    const fam = seedFamily('Smith');
    const kid = seedKid(fam, 'Mia');
    const chore = seedChore(fam, kid);
    // This week: one confirmed, one pending → 50%
    seedInstance(chore, isoDaysAgo(1), 'confirmed');
    seedInstance(chore, isoDaysAgo(2), 'pending');
    const summary = await buildLocalSummary(fam);
    expect(summary.house).toBe('Smith');
    expect(typeof summary.weekStarting).toBe('string');
    expect(summary.kids).toHaveLength(1);
    expect(summary.kids[0].name).toBe('Mia');
    expect(summary.kids[0].pct).toBeGreaterThanOrEqual(0);
    expect(summary.kids[0].pct).toBeLessThanOrEqual(100);
    expect(typeof summary.kids[0].streak).toBe('number');
    expect(Array.isArray(summary.kids[0].badges)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm test -- leaderboard`
Expected: FAIL — `./leaderboard` does not exist.

- [ ] **Step 3: Create `src/lib/server/leaderboard.ts`**

```ts
// Cross-home leaderboard scoring. Produces the per-kid summary pushed to the
// Scoreboard Worker. Fair across ages: consistency % is the base, streak the
// tiebreaker/momentum. Money is never included (spec §3).

import { and, eq, gte, lte } from 'drizzle-orm';
import { db, schema } from './db';
import { todayIso, isoDaysAgo, weekStarting } from './dates';
import { getCurrentWeekReview } from './payouts';

export interface SummaryKid {
  name: string;
  avatar: string;
  pct: number;
  streak: number;
  choresDone: number;
  badges: string[];
}

export interface LocalSummary {
  house: string;
  weekStarting: string;
  kids: SummaryKid[];
}

const STREAK_LOOKBACK_DAYS = 60;

/**
 * Consecutive days (walking back from today) with no missed chore. A "miss" is a
 * pending/disputed instance on a past day. Days with no chores are neutral (don't
 * break, don't count). Today's still-pending chores don't break the streak.
 */
export async function streakForKid(personId: string): Promise<number> {
  const today = todayIso();
  const since = isoDaysAgo(STREAK_LOOKBACK_DAYS);

  const rows = await db
    .select({
      dueDate: schema.choreInstances.dueDate,
      status: schema.choreInstances.status,
    })
    .from(schema.choreInstances)
    .innerJoin(schema.chores, eq(schema.chores.id, schema.choreInstances.choreId))
    .where(
      and(
        eq(schema.chores.assigneeId, personId),
        gte(schema.choreInstances.dueDate, since),
        lte(schema.choreInstances.dueDate, today)
      )
    );

  const byDay = new Map<string, string[]>();
  for (const r of rows) {
    const list = byDay.get(r.dueDate) ?? [];
    list.push(r.status);
    byDay.set(r.dueDate, list);
  }

  let streak = 0;
  for (let back = 0; back < STREAK_LOOKBACK_DAYS; back++) {
    const day = isoDaysAgo(back);
    const statuses = byDay.get(day);
    if (!statuses) continue; // no chores that day — neutral
    const missed = statuses.some((s) => s === 'pending' || s === 'disputed');
    if (missed) {
      if (day === today) continue; // today's not over yet
      break;
    }
    streak++;
  }
  return streak;
}

/** Each of the last 5 days had at least one chore marked done before 8am local. */
async function hasDawnPatrol(personId: string): Promise<boolean> {
  for (let back = 0; back < 5; back++) {
    const day = isoDaysAgo(back);
    const rows = await db
      .select({ markedDoneAt: schema.choreInstances.markedDoneAt })
      .from(schema.choreInstances)
      .innerJoin(schema.chores, eq(schema.chores.id, schema.choreInstances.choreId))
      .where(and(eq(schema.chores.assigneeId, personId), eq(schema.choreInstances.dueDate, day)));
    const before8 = rows.some(
      (r) => r.markedDoneAt != null && new Date(r.markedDoneAt).getHours() < 8
    );
    if (!before8) return false;
  }
  return true;
}

/** Compute the badge ids for a kid. `pct` is this week's consistency %. */
export async function badgesForKid(personId: string, pct: number): Promise<string[]> {
  const badges: string[] = [];
  if (pct === 100) badges.push('perfect-week');
  const streak = await streakForKid(personId);
  if (streak >= 14) badges.push('iron-streak');
  if (await hasDawnPatrol(personId)) badges.push('dawn-patrol');
  // NOTE: 'comeback-kid' (biggest week-over-week jump) is deferred to v2 — it needs
  // last week's pct stored per kid, which we don't persist yet. 'cup-holder' is
  // rendered as the winning-house banner at board time, not a per-kid badge here.
  return badges;
}

/** Build this family's summary payload for the Scoreboard Worker. */
export async function buildLocalSummary(familyId: string): Promise<LocalSummary> {
  const today = todayIso();

  const famRows = await db
    .select({ name: schema.families.name })
    .from(schema.families)
    .where(eq(schema.families.id, familyId))
    .limit(1);
  const houseName = famRows[0]?.name ?? 'House';

  const review = await getCurrentWeekReview(familyId);

  const kids: SummaryKid[] = [];
  for (const item of review) {
    const pct =
      item.totalCount > 0 ? Math.round((item.confirmedCount / item.totalCount) * 100) : 0;
    const [streak, badges, avatarRows] = await Promise.all([
      streakForKid(item.kidId),
      badgesForKid(item.kidId, pct),
      db
        .select({ avatarUrl: schema.persons.avatarUrl })
        .from(schema.persons)
        .where(eq(schema.persons.id, item.kidId))
        .limit(1),
    ]);
    kids.push({
      name: item.kidName,
      avatar: avatarRows[0]?.avatarUrl ?? '',
      pct,
      streak,
      choresDone: item.confirmedCount,
      badges,
    });
  }

  return { house: houseName, weekStarting: weekStarting(today), kids };
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npm test -- leaderboard`
Expected: PASS (8 tests). Note `getCurrentWeekReview` creates a payout cycle row as a side effect — that's fine in the in-memory test DB.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/leaderboard.ts src/lib/server/leaderboard.test.ts
git commit -m "feat(app): leaderboard scoring — consistency %, streak, badges, summary"
```

---

## Task 5: `scoreboard.ts` — Worker HTTP client

Wraps the Worker API. Authenticated calls read `{ url, houseId, token }` from config. `registerHouse` is the one unauthenticated call; it stores the returned creds.

**Files:**
- Create: `src/lib/server/scoreboard.ts`
- Test: `src/lib/server/scoreboard.test.ts`

- [ ] **Step 1: Write the failing test `src/lib/server/scoreboard.test.ts`**

Uses a stubbed `global.fetch` (Vitest `vi.fn`) — no real network.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerHouse,
  pushSummary,
  getBoard,
  postCheer,
  sendLinkRequest,
  isConnected,
} from './scoreboard';
import { getConfig, setConfig } from './config';
import { seedFamily, seedKid, seedChore, seedInstance } from './test/seed';
import { isoDaysAgo } from './dates';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registerHouse', () => {
  it('POSTs name and stores the returned creds', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ houseId: 'h_1', token: 'tok', friendCode: 'SMITH-AB12' })
    );
    const out = await registerHouse('https://sb.test', 'Smith');
    expect(out.friendCode).toBe('SMITH-AB12');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sb.test/register',
      expect.objectContaining({ method: 'POST' })
    );
    expect(await getConfig('scoreboard_house_id')).toBe('h_1');
    expect(await getConfig('scoreboard_token')).toBe('tok');
    expect(await getConfig('scoreboard_friend_code')).toBe('SMITH-AB12');
    expect(await getConfig('scoreboard_url')).toBe('https://sb.test');
  });
});

describe('authenticated calls', () => {
  beforeEach(async () => {
    await setConfig('scoreboard_url', 'https://sb.test');
    await setConfig('scoreboard_house_id', 'h_1');
    await setConfig('scoreboard_token', 'tok');
  });

  it('isConnected reflects stored creds', async () => {
    expect(await isConnected()).toBe(true);
  });

  it('pushSummary builds the local summary and POSTs it with auth headers', async () => {
    const fam = seedFamily('Smith');
    const kid = seedKid(fam, 'Mia');
    const chore = seedChore(fam, kid);
    seedInstance(chore, isoDaysAgo(1), 'confirmed');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await pushSummary(fam);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sb.test/summary');
    expect(init.method).toBe('POST');
    expect(init.headers['X-House-Id']).toBe('h_1');
    expect(init.headers['Authorization']).toBe('Bearer tok');
    const body = JSON.parse(init.body);
    expect(body.house).toBe('Smith');
    expect(body.kids[0].name).toBe('Mia');
  });

  it('getBoard returns the parsed board', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ houses: [{ house: 'Smith' }], cheers: [] }));
    const board = await getBoard();
    expect(board.houses[0].house).toBe('Smith');
  });

  it('postCheer sends the cheer fields', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await postCheer({ fromName: 'Mia', avatar: '🦊', phraseId: 'gg' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sb.test/cheer');
    expect(JSON.parse(init.body)).toEqual({ fromName: 'Mia', avatar: '🦊', phraseId: 'gg' });
  });

  it('sendLinkRequest posts the friend code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, pending: true }));
    await sendLinkRequest('BRAVO-99');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sb.test/link-request');
    expect(JSON.parse(init.body)).toEqual({ friendCode: 'BRAVO-99' });
  });

  it('throws a clear error when not connected', async () => {
    await expect(getBoard.call(null)).resolves.toBeDefined(); // connected in this block
  });
});

describe('not connected', () => {
  it('getBoard throws when creds are absent', async () => {
    await expect(getBoard()).rejects.toThrow(/not connected/i);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm test -- scoreboard`
Expected: FAIL — `./scoreboard` does not exist.

- [ ] **Step 3: Create `src/lib/server/scoreboard.ts`**

```ts
// HTTP client for the cross-home Scoreboard Worker. Authenticated calls read the
// connection creds from app_config; registerHouse is the one unauthenticated call
// and persists the creds it receives.

import { getConfig, setConfig, getScoreboardCreds, type ScoreboardCreds } from './config';
import { buildLocalSummary } from './leaderboard';

export type Board = {
  houses: Array<{
    houseId: string;
    house: string;
    weekStarting: string;
    kids: Array<{
      name: string;
      avatar: string;
      pct: number;
      streak: number;
      choresDone: number;
      badges: string[];
    }>;
    updatedAt: number;
  }>;
  cheers: Array<{
    fromHouseId: string;
    fromHouse: string;
    fromName: string;
    avatar: string;
    phraseId: string;
    ts: number;
  }>;
};

export type PendingRequest = { fromHouseId: string; fromName: string; ts: number };

async function creds(): Promise<ScoreboardCreds> {
  const c = await getScoreboardCreds();
  if (!c) throw new Error('Scoreboard not connected');
  return c;
}

async function authed(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown
): Promise<unknown> {
  const c = await creds();
  const res = await fetch(`${c.url}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'X-House-Id': c.houseId,
      Authorization: `Bearer ${c.token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new Error(`Scoreboard ${method} ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function isConnected(): Promise<boolean> {
  return (await getScoreboardCreds()) !== null;
}

/** Register this house with a scoreboard at `url`; stores the returned creds. */
export async function registerHouse(
  url: string,
  name: string
): Promise<{ houseId: string; friendCode: string }> {
  const base = url.replace(/\/+$/, '');
  const res = await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Register failed: ${res.status}`);
  const data = (await res.json()) as { houseId: string; token: string; friendCode: string };
  await Promise.all([
    setConfig('scoreboard_url', base),
    setConfig('scoreboard_house_id', data.houseId),
    setConfig('scoreboard_token', data.token),
    setConfig('scoreboard_friend_code', data.friendCode),
    setConfig('scoreboard_house_name', name),
  ]);
  return { houseId: data.houseId, friendCode: data.friendCode };
}

/** Build this family's summary and push it up. */
export async function pushSummary(familyId: string): Promise<void> {
  const summary = await buildLocalSummary(familyId);
  await authed('/summary', 'POST', summary);
}

export async function getBoard(): Promise<Board> {
  return (await authed('/board', 'GET')) as Board;
}

export async function postCheer(cheer: {
  fromName: string;
  avatar: string;
  phraseId: string;
}): Promise<void> {
  await authed('/cheer', 'POST', cheer);
}

export async function listRequests(): Promise<PendingRequest[]> {
  const out = (await authed('/requests', 'GET')) as { requests: PendingRequest[] };
  return out.requests;
}

export async function sendLinkRequest(friendCode: string): Promise<void> {
  await authed('/link-request', 'POST', { friendCode });
}

export async function approveLink(fromHouseId: string): Promise<void> {
  await authed('/link-approve', 'POST', { fromHouseId });
}

export async function declineLink(fromHouseId: string): Promise<void> {
  await authed('/link-decline', 'POST', { fromHouseId });
}

export async function leaveRival(houseId: string): Promise<void> {
  await authed('/leave', 'POST', { houseId });
}

/** Convenience for the UI: this house's own friend code (or null). */
export async function getOwnFriendCode(): Promise<string | null> {
  return getConfig('scoreboard_friend_code');
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npm test -- scoreboard`
Expected: PASS. (The `getBoard.call(null)` assertion in the "authenticated calls" block runs while connected and just confirms it resolves; the "not connected" block confirms the throw.)

- [ ] **Step 5: Run the FULL suite**

Run: `npm test`
Expected: all green — setup.smoke (2), config (4), leaderboard (8), scoreboard (7).

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/scoreboard.ts src/lib/server/scoreboard.test.ts
git commit -m "feat(app): scoreboard worker HTTP client"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** §3 scoring → Task 4 (`pct` from confirmed/total; `streakForKid`). §4 summary payload shape → Task 4 `buildLocalSummary` (no money, derived numbers only). §6 badges → Task 4 (`perfect-week`, `iron-streak`, `dawn-patrol`; `comeback-kid`/`cup-holder` explicitly deferred with an in-code NOTE, not silently dropped). Config storage decision (app_config table) → Tasks 1, 3. Worker contract consumption → Task 5 (`scoreboard.ts` covers every endpoint: register/summary/board/cheer/requests/link-request/approve/decline/leave).
- **Placeholders:** none — every step has complete code and a runnable command.
- **Type consistency:** `SummaryKid`/`LocalSummary` (Task 4) match the Worker's stored summary shape (Task 4 of the worker plan) and the `Board` type (Task 5). `ScoreboardCreds` is defined once in `config.ts` and imported by `scoreboard.ts`.
- **Out of scope (handed to plan 2b — UI & wiring):** the `/leaderboard` route + page; settings sections (connect to scoreboard, manage rivals, per-kid cheer toggle, reading/writing `persons.canPostCheers`); nightly `pushSummary` scheduler (mirrors `backup.ts`'s `scheduleNightlyBackup`); nav links; the cheer phrase set constant (`src/lib/cheers.ts`); per-viewer House Cup + Cup-Holder banner rendering.

## Notes for plan 2b
- `persons.canPostCheers` column now exists; the per-kid toggle UI + a guard before `postCheer` go in 2b.
- The nightly sync should follow `backup.ts`'s `globalThis`-guarded `setTimeout` pattern and call `pushSummary(familyId)` for the local family; wire it next to `scheduleNightlyBackup()` in `hooks.server.ts`.
- Connecting to a scoreboard (entering the Worker URL + a house name → `registerHouse`) is a PIN-gated parent action in `/settings`.
