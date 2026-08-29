# Queued Payout Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make missed weekly allowance reviews queue up instead of silently expiring, with per-week age-correct amounts, bulk approve/skip for older weeks, and a payout-day reminder push.

**Architecture:** Replace the single-week read path (`getCurrentWeekReview`) with a lazy backfill that walks from a per-kid floor date to today, get-or-creating a `payout_cycles` row per week and returning the unfinalized ones bucketed into `current` / `recent` / `older`. Add transactional batch approve/skip for the collapsed older bucket. Add a daily scheduler that pushes a reminder on the family's `payoutDay` when the queue is non-empty.

**Tech Stack:** SvelteKit 2 (Svelte 4), TypeScript, Drizzle ORM over better-sqlite3, Vitest, Tailwind, web-push.

**Spec:** `docs/superpowers/specs/2026-08-29-queued-payout-review-design.md`

## Global Constraints

- **No schema change.** `payout_cycles` already has every column needed. No Drizzle migration in this plan.
- **All money is integer cents.** Never use floats for amounts.
- **All dates without a time are ISO `YYYY-MM-DD` local-time strings.** ISO date strings compare correctly with `<`, `>`, and `localeCompare`.
- **All timestamps are integer epoch milliseconds.**
- **Responsibility weeks stay Mon–Sun** via the existing `weekStarting()` / `weekEnding()`. This plan does not change week boundaries.
- **A past week's `suggested_amount_cents` is frozen once written.** Only the current week's suggestion may be refreshed.
- **better-sqlite3 transactions are synchronous.** Inside `db.transaction((tx) => {...})` use the sync Drizzle API — `.all()`, `.get()`, `.run()` — never `await`.
- **Kid-facing UI is out of scope.** Do not surface queued weeks to kids anywhere.
- Run tests with `npm test` (vitest, `:memory:` DB, tables truncated after each test).

---

### Task 1: Date helpers for week enumeration

Two pure helpers `getReviewQueue` needs: converting an epoch-ms `createdAt` into an ISO date, and enumerating every Monday across a span.

**Files:**
- Modify: `src/lib/server/dates.ts` (append to end of file)
- Test: `src/lib/server/dates.test.ts` (create)

**Interfaces:**
- Consumes: existing `toIsoDate`, `parseIsoDate`, `weekStarting` from the same file.
- Produces:
  - `isoFromEpochMs(ms: number): string`
  - `weekStartsBetween(fromIso: string, toIso: string): string[]` — Mondays oldest-first, inclusive of both endpoints' weeks; `[]` if `toIso`'s week precedes `fromIso`'s week.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/dates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isoFromEpochMs, weekStartsBetween } from '$lib/server/dates';

describe('isoFromEpochMs', () => {
  it('converts an epoch-ms timestamp to a local ISO date', () => {
    const ms = new Date(2026, 7, 26, 14, 30).getTime(); // 2026-08-26 local
    expect(isoFromEpochMs(ms)).toBe('2026-08-26');
  });
});

describe('weekStartsBetween', () => {
  it('returns one Monday when both dates fall in the same week', () => {
    // 2026-08-26 is a Wednesday, 2026-08-29 a Saturday; both in the week of Mon 2026-08-24.
    expect(weekStartsBetween('2026-08-26', '2026-08-29')).toEqual(['2026-08-24']);
  });

  it('returns every Monday across a span, oldest first', () => {
    expect(weekStartsBetween('2026-08-10', '2026-08-29')).toEqual([
      '2026-08-10',
      '2026-08-17',
      '2026-08-24',
    ]);
  });

  it('includes the week containing a mid-week start date', () => {
    // 2026-08-12 is a Wednesday → its week starts Mon 2026-08-10.
    expect(weekStartsBetween('2026-08-12', '2026-08-24')).toEqual([
      '2026-08-10',
      '2026-08-17',
      '2026-08-24',
    ]);
  });

  it('returns empty when the end week precedes the start week', () => {
    expect(weekStartsBetween('2026-08-24', '2026-08-10')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/server/dates.test.ts`
Expected: FAIL — `isoFromEpochMs is not a function` / `weekStartsBetween is not a function`.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/server/dates.ts`:

```ts
/** Convert an epoch-ms timestamp (e.g. persons.createdAt) to a local ISO date. */
export function isoFromEpochMs(ms: number): string {
  return toIsoDate(new Date(ms));
}

/**
 * Every week-start (Monday) from the week containing `fromIso` through the week
 * containing `toIso`, inclusive, oldest first.
 *
 * Used to enumerate the weeks a payout backfill must cover. Returns [] when
 * `toIso`'s week precedes `fromIso`'s week.
 */
export function weekStartsBetween(fromIso: string, toIso: string): string[] {
  const last = weekStarting(toIso);
  const out: string[] = [];
  let cursor = weekStarting(fromIso);
  while (cursor <= last) {
    out.push(cursor);
    const d = parseIsoDate(cursor);
    d.setDate(d.getDate() + 7);
    cursor = toIsoDate(d);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/server/dates.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/dates.ts src/lib/server/dates.test.ts
git commit -m "feat(dates): add isoFromEpochMs and weekStartsBetween helpers"
```

---

### Task 2: Backfill unreviewed weeks

The core change. `collectReviewItems` walks every week from each kid's floor date to today, materializes missing cycles, and returns the unfinalized ones.

The seed helpers need optional `createdAt` / `payoutDay` parameters first — backfill tests must place a kid's creation in the past, and wall-clock-relative tests are the only way to exercise "6 weeks ago" without freezing time.

**Files:**
- Modify: `src/lib/server/test/seed.ts` (add optional params to `seedFamily`, `seedKid`)
- Modify: `src/lib/server/payouts.ts` (add `collectReviewItems`; keep `getCurrentWeekReview` for now)
- Test: `src/lib/server/payout-backfill.test.ts` (create)

**Interfaces:**
- Consumes: `isoFromEpochMs`, `weekStartsBetween` (Task 1); existing `weekStarting`, `weekEnding`, `ageOn`, `todayIso` from `dates.ts`; existing `resolvePayoutConfig`, `computeSuggestedCents` from `payout-config.ts`; existing `WeeklyReviewItem` type.
- Produces:
  - `collectReviewItems(familyId: string): Promise<WeeklyReviewItem[]>` — every unfinalized week for every active kid, sorted newest week first then by kid name. `WeeklyReviewItem` is unchanged from its current definition.
  - `seedFamily(name?: string, opts?: { createdAt?: number; payoutDay?: number }): string`
  - `seedKid(familyId: string, name: string, birthdate?: string, opts?: { createdAt?: number }): string`

- [ ] **Step 1: Extend the seed helpers**

These are test fixtures, not production code, so they land before the failing test rather than after it.

In `src/lib/server/test/seed.ts`, replace `seedFamily` and `seedKid` with:

```ts
export function seedFamily(
  name = 'Test Fam',
  opts: { createdAt?: number; payoutDay?: number } = {}
): string {
  const id = crypto.randomUUID();
  db.insert(schema.families)
    .values({
      id,
      name,
      payoutDay: opts.payoutDay ?? 0,
      createdAt: opts.createdAt ?? Date.now(),
    })
    .run();
  return id;
}

export function seedKid(
  familyId: string,
  name: string,
  birthdate = '2016-01-01',
  opts: { createdAt?: number } = {}
): string {
  const id = crypto.randomUUID();
  db.insert(schema.persons)
    .values({
      id,
      familyId,
      name,
      role: 'kid',
      birthdate,
      createdAt: opts.createdAt ?? Date.now(),
    })
    .run();
  return id;
}
```

Both new parameters are optional and defaulted, so every existing call site keeps working.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/server/payout-backfill.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/server/db';
import { eq, and } from 'drizzle-orm';
import { seedFamily, seedKid, seedChore, seedInstance } from '$lib/server/test/seed';
import { collectReviewItems } from '$lib/server/payouts';
import { todayIso, weekStarting, weekEnding, parseIsoDate, toIsoDate } from '$lib/server/dates';

/** Epoch ms for N weeks before today, at midday to avoid DST edges. */
function weeksAgoMs(n: number): number {
  const d = parseIsoDate(todayIso());
  d.setDate(d.getDate() - n * 7);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

/** ISO week-start N weeks before the current week. */
function weekStartAgo(n: number): string {
  const d = parseIsoDate(weekStarting(todayIso()));
  d.setDate(d.getDate() - n * 7);
  return toIsoDate(d);
}

describe('collectReviewItems backfill', () => {
  it('materializes a cycle for every week since the kid was created', async () => {
    const fam = seedFamily('Backfill Fam', { createdAt: weeksAgoMs(10) });
    seedKid(fam, 'Amy', '2016-01-01', { createdAt: weeksAgoMs(6) });

    const items = await collectReviewItems(fam);

    // 6 weeks ago through the current week, inclusive = 7 weeks.
    expect(items).toHaveLength(7);
    expect(items[0].weekStarting).toBe(weekStarting(todayIso()));
    expect(items[items.length - 1].weekStarting).toBe(weekStartAgo(6));
  });

  it('does not create weeks before the later of kid and family creation', async () => {
    // Family is old, kid is new — the kid's creation is the floor.
    const fam = seedFamily('Late Kid Fam', { createdAt: weeksAgoMs(20) });
    const kid = seedKid(fam, 'Ben', '2016-01-01', { createdAt: weeksAgoMs(2) });

    await collectReviewItems(fam);

    const cycles = await db
      .select()
      .from(schema.payoutCycles)
      .where(eq(schema.payoutCycles.kidId, kid));
    expect(cycles).toHaveLength(3); // 2 weeks ago, 1 week ago, this week
    for (const c of cycles) {
      expect(c.weekStarting >= weekStartAgo(2)).toBe(true);
    }
  });

  it('is idempotent — a second call creates no duplicate cycles', async () => {
    const fam = seedFamily('Idempotent Fam', { createdAt: weeksAgoMs(5) });
    const kid = seedKid(fam, 'Cal', '2016-01-01', { createdAt: weeksAgoMs(5) });

    await collectReviewItems(fam);
    await collectReviewItems(fam);

    const cycles = await db
      .select()
      .from(schema.payoutCycles)
      .where(eq(schema.payoutCycles.kidId, kid));
    expect(cycles).toHaveLength(6);
  });

  it('uses the kid age as of each week end, not today', async () => {
    // Birthday 3 weeks ago: weeks before it pay one year less.
    const bdayWeeksAgo = 3;
    const bday = parseIsoDate(todayIso());
    bday.setDate(bday.getDate() - bdayWeeksAgo * 7);
    const birthdate = `2016-${String(bday.getMonth() + 1).padStart(2, '0')}-${String(
      bday.getDate()
    ).padStart(2, '0')}`;

    const fam = seedFamily('Birthday Fam', { createdAt: weeksAgoMs(8) });
    seedKid(fam, 'Dee', birthdate, { createdAt: weeksAgoMs(6) });

    const items = await collectReviewItems(fam);
    const current = items.find((i) => i.weekStarting === weekStarting(todayIso()))!;
    const old = items.find((i) => i.weekStarting === weekStartAgo(6))!;

    expect(current.suggestedAmountCents).toBe(old.suggestedAmountCents + 100);
  });

  it('freezes a past week amount even after the age changes', async () => {
    const fam = seedFamily('Frozen Fam', { createdAt: weeksAgoMs(4) });
    const kid = seedKid(fam, 'Eli', '2016-01-01', { createdAt: weeksAgoMs(4) });

    await collectReviewItems(fam);

    const pastWeek = weekStartAgo(3);
    // Simulate a stale/incorrect stored amount on a past week.
    db.update(schema.payoutCycles)
      .set({ suggestedAmountCents: 4242 })
      .where(
        and(
          eq(schema.payoutCycles.kidId, kid),
          eq(schema.payoutCycles.weekStarting, pastWeek)
        )
      )
      .run();

    const items = await collectReviewItems(fam);
    const item = items.find((i) => i.weekStarting === pastWeek)!;
    expect(item.suggestedAmountCents).toBe(4242);
  });

  it('still refreshes the current week amount', async () => {
    const fam = seedFamily('Refresh Fam', { createdAt: weeksAgoMs(2) });
    const kid = seedKid(fam, 'Fay', '2016-01-01', { createdAt: weeksAgoMs(2) });

    await collectReviewItems(fam);

    const thisWeek = weekStarting(todayIso());
    db.update(schema.payoutCycles)
      .set({ suggestedAmountCents: 4242 })
      .where(
        and(
          eq(schema.payoutCycles.kidId, kid),
          eq(schema.payoutCycles.weekStarting, thisWeek)
        )
      )
      .run();

    const items = await collectReviewItems(fam);
    const item = items.find((i) => i.weekStarting === thisWeek)!;
    expect(item.suggestedAmountCents).not.toBe(4242);
  });

  it('omits paid and skipped weeks', async () => {
    const fam = seedFamily('Finalized Fam', { createdAt: weeksAgoMs(4) });
    const kid = seedKid(fam, 'Gus', '2016-01-01', { createdAt: weeksAgoMs(4) });

    await collectReviewItems(fam);
    db.update(schema.payoutCycles)
      .set({ status: 'paid', actualAmountCents: 800 })
      .where(
        and(
          eq(schema.payoutCycles.kidId, kid),
          eq(schema.payoutCycles.weekStarting, weekStartAgo(2))
        )
      )
      .run();

    const items = await collectReviewItems(fam);
    expect(items.map((i) => i.weekStarting)).not.toContain(weekStartAgo(2));
    expect(items).toHaveLength(4); // 5 weeks minus the paid one
  });

  it('counts chores from that week, not from today', async () => {
    const fam = seedFamily('Chore Fam', { createdAt: weeksAgoMs(3) });
    const kid = seedKid(fam, 'Hal', '2016-01-01', { createdAt: weeksAgoMs(3) });
    const chore = seedChore(fam, kid, 'Dishes');

    const targetWeek = weekStartAgo(2);
    seedInstance(chore, targetWeek, 'confirmed');
    seedInstance(chore, weekEnding(targetWeek), 'pending');

    const items = await collectReviewItems(fam);
    const target = items.find((i) => i.weekStarting === targetWeek)!;
    const other = items.find((i) => i.weekStarting === weekStartAgo(1))!;

    expect(target.totalCount).toBe(2);
    expect(target.confirmedCount).toBe(1);
    expect(target.pendingCount).toBe(1);
    expect(target.missedChoreNames).toEqual(['Dishes']);
    expect(other.totalCount).toBe(0);
  });

  it('excludes archived kids', async () => {
    const fam = seedFamily('Archived Fam', { createdAt: weeksAgoMs(3) });
    const kid = seedKid(fam, 'Ivy', '2016-01-01', { createdAt: weeksAgoMs(3) });
    db.update(schema.persons)
      .set({ active: false })
      .where(eq(schema.persons.id, kid))
      .run();

    expect(await collectReviewItems(fam)).toEqual([]);
  });

  it('sorts newest week first, then by kid name', async () => {
    const fam = seedFamily('Sort Fam', { createdAt: weeksAgoMs(2) });
    seedKid(fam, 'Zoe', '2016-01-01', { createdAt: weeksAgoMs(2) });
    seedKid(fam, 'Abe', '2016-01-01', { createdAt: weeksAgoMs(2) });

    const items = await collectReviewItems(fam);
    expect(items.slice(0, 2).map((i) => i.kidName)).toEqual(['Abe', 'Zoe']);
    expect(items[0].weekStarting).toBe(weekStarting(todayIso()));
    expect(items[items.length - 1].weekStarting).toBe(weekStartAgo(2));
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/server/payout-backfill.test.ts`
Expected: FAIL — `collectReviewItems is not a function`.

- [ ] **Step 4: Implement `collectReviewItems`**

In `src/lib/server/payouts.ts`, update the imports at the top of the file:

```ts
import { and, eq, gte, lte, inArray } from 'drizzle-orm';
import { db, schema } from './db';
import {
  todayIso,
  weekStarting,
  weekEnding,
  ageOn,
  isoFromEpochMs,
  weekStartsBetween,
} from './dates';
import { resolvePayoutConfig, computeSuggestedCents } from './payout-config';
```

Then add this function below the `WeeklyReviewItem` type (leave `getCurrentWeekReview` in place; Task 3 removes it):

```ts
/**
 * Every unfinalized payout week for every active kid in the family, newest week
 * first, then by kid name.
 *
 * Cycles are created lazily here rather than by a scheduled job: this is a
 * self-hosted server that gets powered off, so the read path is the only place
 * guaranteed to run. Backfill walks from the later of the kid's and family's
 * creation date, so a kid added last month isn't owed for weeks before they
 * existed.
 *
 * A past week's suggested amount is frozen once written — it's history. Only the
 * current week's suggestion is refreshed (for a birthday landing mid-week).
 */
export async function collectReviewItems(familyId: string): Promise<WeeklyReviewItem[]> {
  const today = todayIso();
  const currentWeek = weekStarting(today);

  const famRows = await db
    .select({
      createdAt: schema.families.createdAt,
      payoutMode: schema.families.payoutMode,
      payoutCentsPerYear: schema.families.payoutCentsPerYear,
      payoutBonusCents: schema.families.payoutBonusCents,
      payoutFixedCents: schema.families.payoutFixedCents,
    })
    .from(schema.families)
    .where(eq(schema.families.id, familyId))
    .limit(1);
  const family = famRows[0];
  if (!family) return [];

  const kids = await db
    .select({
      id: schema.persons.id,
      name: schema.persons.name,
      birthdate: schema.persons.birthdate,
      payoutOverride: schema.persons.payoutOverride,
      createdAt: schema.persons.createdAt,
    })
    .from(schema.persons)
    .where(
      and(
        eq(schema.persons.familyId, familyId),
        eq(schema.persons.role, 'kid'),
        eq(schema.persons.active, true)
      )
    );

  const items: WeeklyReviewItem[] = [];

  for (const kid of kids) {
    const cfg = resolvePayoutConfig(family, kid.payoutOverride);
    const floorIso = isoFromEpochMs(Math.max(kid.createdAt, family.createdAt));
    const weeks = weekStartsBetween(floorIso, today);

    const existing = await db
      .select()
      .from(schema.payoutCycles)
      .where(eq(schema.payoutCycles.kidId, kid.id));
    const byWeek = new Map(existing.map((c) => [c.weekStarting, c]));

    for (const wkStart of weeks) {
      const wkEnd = weekEnding(wkStart);
      const age = kid.birthdate ? ageOn(kid.birthdate, wkEnd) : 0;
      const suggested = computeSuggestedCents(cfg, age);

      let cycle = byWeek.get(wkStart);

      if (!cycle) {
        // onConflictDoNothing + read-back: two parents loading /review at once
        // must not trip the (kid_id, week_starting) unique index.
        db.insert(schema.payoutCycles)
          .values({
            id: crypto.randomUUID(),
            kidId: kid.id,
            weekStarting: wkStart,
            status: 'open',
            suggestedAmountCents: suggested,
          })
          .onConflictDoNothing()
          .run();
        cycle = (
          await db
            .select()
            .from(schema.payoutCycles)
            .where(
              and(
                eq(schema.payoutCycles.kidId, kid.id),
                eq(schema.payoutCycles.weekStarting, wkStart)
              )
            )
            .limit(1)
        )[0];
        if (!cycle) continue;
      } else if (
        wkStart === currentWeek &&
        cycle.status === 'open' &&
        cycle.suggestedAmountCents !== suggested
      ) {
        // Birthday bumped age mid-week; refresh the in-progress week only.
        db.update(schema.payoutCycles)
          .set({ suggestedAmountCents: suggested })
          .where(eq(schema.payoutCycles.id, cycle.id))
          .run();
        cycle = { ...cycle, suggestedAmountCents: suggested };
      }

      if (cycle.status === 'paid' || cycle.status === 'skipped') continue;

      const instances = await db
        .select({
          status: schema.choreInstances.status,
          choreName: schema.chores.name,
        })
        .from(schema.choreInstances)
        .innerJoin(schema.chores, eq(schema.chores.id, schema.choreInstances.choreId))
        .where(
          and(
            eq(schema.chores.assigneeId, kid.id),
            gte(schema.choreInstances.dueDate, wkStart),
            lte(schema.choreInstances.dueDate, wkEnd)
          )
        );

      const confirmedCount = instances.filter((i) => i.status === 'confirmed').length;
      const pendingCount = instances.filter((i) => i.status === 'pending').length;
      const disputedCount = instances.filter((i) => i.status === 'disputed').length;
      const doneCount = instances.filter((i) => i.status === 'done').length;

      items.push({
        cycleId: cycle.id,
        kidId: kid.id,
        kidName: kid.name,
        age,
        weekStarting: wkStart,
        weekEnding: wkEnd,
        suggestedAmountCents: cycle.suggestedAmountCents,
        status: cycle.status,
        actualAmountCents: cycle.actualAmountCents,
        // 'done' counts toward responsibility — the kid did their part.
        confirmedCount: confirmedCount + doneCount,
        pendingCount,
        disputedCount,
        totalCount: instances.length,
        missedChoreNames: instances
          .filter((i) => i.status === 'pending' || i.status === 'disputed')
          .map((i) => i.choreName),
      });
    }
  }

  items.sort(
    (a, b) =>
      b.weekStarting.localeCompare(a.weekStarting) || a.kidName.localeCompare(b.kidName)
  );
  return items;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/server/payout-backfill.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Run the full suite — nothing else may break**

Run: `npm test`
Expected: PASS. `getCurrentWeekReview` is still present and untouched, so the existing `payouts.test.ts` still passes.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/payouts.ts src/lib/server/payout-backfill.test.ts src/lib/server/test/seed.ts
git commit -m "feat(payouts): backfill unreviewed weeks with age-at-that-week amounts"
```

---

### Task 3: Bucket the queue and retire `getCurrentWeekReview`

Split the flat item list into the three sections the review screen renders, and delete the single-week function it replaces.

**Files:**
- Create: `src/lib/review-types.ts`
- Modify: `src/lib/server/payouts.ts`
- Modify: `src/lib/server/payouts.test.ts` (retarget the three `getCurrentWeekReview` tests)
- Test: `src/lib/server/payout-queue.test.ts` (create)

**Interfaces:**
- Consumes: `collectReviewItems` (Task 2).
- Produces:
  - `src/lib/review-types.ts` exporting `WeeklyReviewItem` and `ReviewQueue`
  - `getReviewQueue(familyId: string): Promise<ReviewQueue>`
  - `DETAIL_WEEKS: number` (exported constant, value `2`)
  - `getCurrentWeekReview` is **removed**.

**Why the type moves out of `$lib/server`:** Task 6's `ReviewCard.svelte` needs
`WeeklyReviewItem` to type its prop, and SvelteKit treats `$lib/server` as a
protected directory that client code may not import from. Types shared between
server and component code live in `$lib` proper — the same place
`src/lib/leaderboard-view.ts` and `src/lib/cheers.ts` already sit.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/payout-queue.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { seedFamily, seedKid } from '$lib/server/test/seed';
import { getReviewQueue } from '$lib/server/payouts';
import { todayIso, weekStarting, parseIsoDate, toIsoDate } from '$lib/server/dates';

function weeksAgoMs(n: number): number {
  const d = parseIsoDate(todayIso());
  d.setDate(d.getDate() - n * 7);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

function weekStartAgo(n: number): string {
  const d = parseIsoDate(weekStarting(todayIso()));
  d.setDate(d.getDate() - n * 7);
  return toIsoDate(d);
}

describe('getReviewQueue bucketing', () => {
  it('puts this week in current and the 2 newest past weeks in recent', async () => {
    const fam = seedFamily('Bucket Fam', { createdAt: weeksAgoMs(6) });
    seedKid(fam, 'Amy', '2016-01-01', { createdAt: weeksAgoMs(6) });

    const q = await getReviewQueue(fam);

    expect(q.current.map((i) => i.weekStarting)).toEqual([weekStarting(todayIso())]);
    expect(q.recent.map((i) => i.weekStarting)).toEqual([weekStartAgo(1), weekStartAgo(2)]);
    expect(q.older.map((i) => i.weekStarting)).toEqual([
      weekStartAgo(3),
      weekStartAgo(4),
      weekStartAgo(5),
      weekStartAgo(6),
    ]);
  });

  it('leaves older empty when there are only two past weeks', async () => {
    const fam = seedFamily('Small Fam', { createdAt: weeksAgoMs(2) });
    seedKid(fam, 'Ben', '2016-01-01', { createdAt: weeksAgoMs(2) });

    const q = await getReviewQueue(fam);

    expect(q.current).toHaveLength(1);
    expect(q.recent).toHaveLength(2);
    expect(q.older).toEqual([]);
  });

  it('buckets by week, keeping siblings together', async () => {
    const fam = seedFamily('Siblings Fam', { createdAt: weeksAgoMs(4) });
    seedKid(fam, 'Zoe', '2016-01-01', { createdAt: weeksAgoMs(4) });
    seedKid(fam, 'Abe', '2016-01-01', { createdAt: weeksAgoMs(4) });

    const q = await getReviewQueue(fam);

    // Two kids per week: 1 current week, 2 recent weeks, 2 older weeks.
    expect(q.current).toHaveLength(2);
    expect(q.recent).toHaveLength(4);
    expect(q.older).toHaveLength(4);
    expect(new Set(q.recent.map((i) => i.weekStarting)).size).toBe(2);
    expect(q.current.map((i) => i.kidName)).toEqual(['Abe', 'Zoe']);
  });

  it('returns all-empty buckets for a family with no kids', async () => {
    const fam = seedFamily('Empty Fam');
    expect(await getReviewQueue(fam)).toEqual({ current: [], recent: [], older: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/server/payout-queue.test.ts`
Expected: FAIL — `getReviewQueue is not a function`.

- [ ] **Step 3: Move the shared types into `$lib`**

Create `src/lib/review-types.ts`:

```ts
// Types shared between the payout server module and the review components.
// They live outside $lib/server because SvelteKit forbids client code from
// importing anything under $lib/server, and ReviewCard.svelte needs them.

export type WeeklyReviewItem = {
  cycleId: string;
  kidId: string;
  kidName: string;
  age: number;
  weekStarting: string;
  weekEnding: string;
  suggestedAmountCents: number;
  status: 'open' | 'reviewed' | 'paid' | 'skipped';
  actualAmountCents: number | null;
  confirmedCount: number;
  pendingCount: number;
  disputedCount: number;
  totalCount: number;
  missedChoreNames: string[];
};

export type ReviewQueue = {
  /** The in-progress week, one item per active kid. */
  current: WeeklyReviewItem[];
  /** Items from the DETAIL_WEEKS most recent past unreviewed weeks. */
  recent: WeeklyReviewItem[];
  /** Everything older, newest week first. */
  older: WeeklyReviewItem[];
};
```

In `src/lib/server/payouts.ts`, delete the local `WeeklyReviewItem` type
declaration and replace it with a re-export, so existing importers of
`WeeklyReviewItem` from `$lib/server/payouts` keep working:

```ts
import type { WeeklyReviewItem, ReviewQueue } from '$lib/review-types';
export type { WeeklyReviewItem, ReviewQueue };
```

- [ ] **Step 4: Implement `getReviewQueue`**

Add to `src/lib/server/payouts.ts`, immediately after `collectReviewItems`:

```ts
/** Past weeks shown as full cards before the rest collapse into one row. */
export const DETAIL_WEEKS = 2;

/**
 * The review screen's data, bucketed by week (not by kid) so siblings stay
 * side by side and "5 earlier weeks" counts weeks rather than cards.
 */
export async function getReviewQueue(familyId: string): Promise<ReviewQueue> {
  const items = await collectReviewItems(familyId);
  const currentWeek = weekStarting(todayIso());

  const current = items.filter((i) => i.weekStarting === currentWeek);
  const past = items.filter((i) => i.weekStarting !== currentWeek);

  const pastWeeks = [...new Set(past.map((i) => i.weekStarting))].sort().reverse();
  const detail = new Set(pastWeeks.slice(0, DETAIL_WEEKS));

  return {
    current,
    recent: past.filter((i) => detail.has(i.weekStarting)),
    older: past.filter((i) => !detail.has(i.weekStarting)),
  };
}
```

- [ ] **Step 5: Delete `getCurrentWeekReview`**

Remove the entire `getCurrentWeekReview` function from `src/lib/server/payouts.ts` (it spans from its doc comment through its closing brace, ending just before `/** Approve a payout: ... */`). `collectReviewItems` supersedes it completely.

Update the file's header comment — replace the line

```
// A PayoutCycle is one kid's review for one Mon–Sun week.
```

with

```
// A PayoutCycle is one kid's review for one Mon–Sun week. Cycles are backfilled
// lazily on read (collectReviewItems), so a week nobody reviewed still shows up
// later instead of expiring.
```

- [ ] **Step 6: Retarget the existing tests**

In `src/lib/server/payouts.test.ts`, change the import

```ts
import { getCurrentWeekReview } from '$lib/server/payouts';
```

to

```ts
import { collectReviewItems } from '$lib/server/payouts';
```

and replace every `getCurrentWeekReview(` call with `collectReviewItems(`.

Those tests seed kids with a default `createdAt` of "now", so each kid produces exactly one item (the current week) and every existing assertion holds unchanged.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS. If anything still references `getCurrentWeekReview`, the TypeScript error names the file — fix it there.

- [ ] **Step 8: Verify no stale references remain**

Run: `grep -rn "getCurrentWeekReview" src/`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add src/lib/review-types.ts src/lib/server/payouts.ts src/lib/server/payouts.test.ts src/lib/server/payout-queue.test.ts
git commit -m "feat(payouts): bucket review queue into current/recent/older"
```

---

### Task 4: Transactional batch approve and skip

One tap clears a backlog. Each cycle pays its own frozen amount, and the whole batch is atomic.

**Files:**
- Modify: `src/lib/server/payouts.ts`
- Test: `src/lib/server/payout-batch.test.ts` (create)

**Interfaces:**
- Consumes: existing `schema.payoutCycles`, `schema.ledgerEntries`, `schema.persons`.
- Produces:
  - `approvePayoutBatch(familyId: string, parentPersonId: string, cycleIds: string[], note?: string): Promise<number>`
  - `skipPayoutBatch(familyId: string, parentPersonId: string, cycleIds: string[], note?: string): Promise<number>`

  Both return the count of cycles actually acted on. Both throw `Error('Cycle not in this family')` if any id belongs to another family. Existing `approvePayout` / `skipPayout` are unchanged.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/payout-batch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import { seedFamily, seedKid } from '$lib/server/test/seed';
import {
  collectReviewItems,
  approvePayoutBatch,
  skipPayoutBatch,
} from '$lib/server/payouts';
import { todayIso, parseIsoDate } from '$lib/server/dates';

function weeksAgoMs(n: number): number {
  const d = parseIsoDate(todayIso());
  d.setDate(d.getDate() - n * 7);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

function seedParent(familyId: string): string {
  const id = crypto.randomUUID();
  db.insert(schema.persons)
    .values({ id, familyId, name: 'Parent', role: 'parent', createdAt: Date.now() })
    .run();
  return id;
}

describe('approvePayoutBatch', () => {
  it('pays every cycle at its own suggested amount', async () => {
    const fam = seedFamily('Batch Fam', { createdAt: weeksAgoMs(5) });
    const kid = seedKid(fam, 'Amy', '2016-01-01', { createdAt: weeksAgoMs(5) });
    const parent = seedParent(fam);

    const items = await collectReviewItems(fam);
    const expectedTotal = items.reduce((s, i) => s + i.suggestedAmountCents, 0);

    const count = await approvePayoutBatch(
      fam,
      parent,
      items.map((i) => i.cycleId)
    );

    expect(count).toBe(6);

    const entries = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.kidId, kid));
    expect(entries).toHaveLength(6);
    expect(entries.reduce((s, e) => s + e.amountCents, 0)).toBe(expectedTotal);
    for (const e of entries) {
      expect(e.kind).toBe('payout');
      expect(e.description).toMatch(/^Weekly allowance \(week of \d{4}-\d{2}-\d{2}\)$/);
    }
  });

  it('marks every cycle paid with the actual amount recorded', async () => {
    const fam = seedFamily('Marks Fam', { createdAt: weeksAgoMs(3) });
    seedKid(fam, 'Ben', '2016-01-01', { createdAt: weeksAgoMs(3) });
    const parent = seedParent(fam);

    const items = await collectReviewItems(fam);
    await approvePayoutBatch(fam, parent, items.map((i) => i.cycleId));

    const cycles = await db.select().from(schema.payoutCycles);
    for (const c of cycles) {
      expect(c.status).toBe('paid');
      expect(c.actualAmountCents).toBe(c.suggestedAmountCents);
      expect(c.reviewedBy).toBe(parent);
      expect(c.reviewedAt).toBeGreaterThan(0);
    }
  });

  it('skips already-finalized cycles and returns the lower count', async () => {
    const fam = seedFamily('Double Fam', { createdAt: weeksAgoMs(3) });
    seedKid(fam, 'Cal', '2016-01-01', { createdAt: weeksAgoMs(3) });
    const parent = seedParent(fam);

    const items = await collectReviewItems(fam);
    const ids = items.map((i) => i.cycleId);

    expect(await approvePayoutBatch(fam, parent, ids)).toBe(4);
    // A double-tap must be a no-op, not a double payout.
    expect(await approvePayoutBatch(fam, parent, ids)).toBe(0);

    const entries = await db.select().from(schema.ledgerEntries);
    expect(entries).toHaveLength(4);
  });

  it('rejects a cycle belonging to another family', async () => {
    const famA = seedFamily('A', { createdAt: weeksAgoMs(2) });
    seedKid(famA, 'Amy', '2016-01-01', { createdAt: weeksAgoMs(2) });
    const parentA = seedParent(famA);

    const famB = seedFamily('B', { createdAt: weeksAgoMs(2) });
    seedKid(famB, 'Ben', '2016-01-01', { createdAt: weeksAgoMs(2) });

    const itemsB = await collectReviewItems(famB);

    await expect(
      approvePayoutBatch(famA, parentA, [itemsB[0].cycleId])
    ).rejects.toThrow('Cycle not in this family');

    expect(await db.select().from(schema.ledgerEntries)).toHaveLength(0);
  });

  it('writes no ledger entry for a zero-amount cycle', async () => {
    const fam = seedFamily('Zero Fam', { createdAt: weeksAgoMs(2) });
    seedKid(fam, 'Dee', '2016-01-01', { createdAt: weeksAgoMs(2) });
    const parent = seedParent(fam);
    db.update(schema.families)
      .set({ payoutMode: 'fixed', payoutFixedCents: 0 })
      .where(eq(schema.families.id, fam))
      .run();

    const items = await collectReviewItems(fam);
    const count = await approvePayoutBatch(fam, parent, items.map((i) => i.cycleId));

    expect(count).toBe(3);
    expect(await db.select().from(schema.ledgerEntries)).toHaveLength(0);
  });

  it('returns 0 for an empty id list', async () => {
    const fam = seedFamily('Nothing Fam');
    const parent = seedParent(fam);
    expect(await approvePayoutBatch(fam, parent, [])).toBe(0);
  });

  it('skips an unknown cycle id without throwing', async () => {
    const fam = seedFamily('Stale Fam', { createdAt: weeksAgoMs(2) });
    seedKid(fam, 'Ivy', '2016-01-01', { createdAt: weeksAgoMs(2) });
    const parent = seedParent(fam);

    const items = await collectReviewItems(fam);
    const ids = [...items.map((i) => i.cycleId), crypto.randomUUID()];

    // A stale page can post an id that no longer exists; that's a re-render,
    // not an error.
    expect(await approvePayoutBatch(fam, parent, ids)).toBe(3);
  });
});

describe('skipPayoutBatch', () => {
  it('marks cycles skipped and creates no ledger entries', async () => {
    const fam = seedFamily('Skip Fam', { createdAt: weeksAgoMs(3) });
    seedKid(fam, 'Eli', '2016-01-01', { createdAt: weeksAgoMs(3) });
    const parent = seedParent(fam);

    const items = await collectReviewItems(fam);
    const count = await skipPayoutBatch(fam, parent, items.map((i) => i.cycleId));

    expect(count).toBe(4);
    expect(await db.select().from(schema.ledgerEntries)).toHaveLength(0);

    const cycles = await db.select().from(schema.payoutCycles);
    for (const c of cycles) {
      expect(c.status).toBe('skipped');
      expect(c.actualAmountCents).toBe(0);
    }
  });

  it('rejects a cycle belonging to another family', async () => {
    const famA = seedFamily('SA', { createdAt: weeksAgoMs(2) });
    const parentA = seedParent(famA);
    const famB = seedFamily('SB', { createdAt: weeksAgoMs(2) });
    seedKid(famB, 'Fay', '2016-01-01', { createdAt: weeksAgoMs(2) });

    const itemsB = await collectReviewItems(famB);

    await expect(
      skipPayoutBatch(famA, parentA, [itemsB[0].cycleId])
    ).rejects.toThrow('Cycle not in this family');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/server/payout-batch.test.ts`
Expected: FAIL — `approvePayoutBatch is not a function`.

- [ ] **Step 3: Implement the batch functions**

Append to `src/lib/server/payouts.ts`:

```ts
/**
 * Throws if any id belongs to a kid outside `familyId`. The batch actions take
 * ids straight from form data, so ownership can't be assumed the way it can for
 * the single-cycle actions (whose ids come from a trusted page load).
 *
 * Ids that don't exist at all are not an error — they're skipped by the caller's
 * loop. A stale page is a re-render, not an attack.
 */
async function assertCyclesInFamily(familyId: string, cycleIds: string[]): Promise<void> {
  if (cycleIds.length === 0) return;
  const rows = await db
    .select({ id: schema.payoutCycles.id, familyId: schema.persons.familyId })
    .from(schema.payoutCycles)
    .innerJoin(schema.persons, eq(schema.persons.id, schema.payoutCycles.kidId))
    .where(inArray(schema.payoutCycles.id, cycleIds));
  if (rows.some((r) => r.familyId !== familyId)) {
    throw new Error('Cycle not in this family');
  }
}

/**
 * Approve several weeks at once, each at its own frozen suggested amount — so a
 * birthday inside the backlog still pays $8 for May weeks and $9 for June weeks.
 *
 * Runs in a transaction and re-reads each cycle's status inside it: both parents'
 * phones can hit "Approve all" at the same time, and a double-tap on a slow LAN
 * is ordinary. Returns how many cycles were actually paid.
 */
export async function approvePayoutBatch(
  familyId: string,
  parentPersonId: string,
  cycleIds: string[],
  note?: string
): Promise<number> {
  if (cycleIds.length === 0) return 0;
  await assertCyclesInFamily(familyId, cycleIds);

  const now = Date.now();
  let count = 0;

  // better-sqlite3 transactions are synchronous — no await inside this callback.
  db.transaction((tx) => {
    for (const id of cycleIds) {
      const cycle = tx
        .select()
        .from(schema.payoutCycles)
        .where(eq(schema.payoutCycles.id, id))
        .limit(1)
        .all()[0];
      if (!cycle) continue;
      if (cycle.status === 'paid' || cycle.status === 'skipped') continue;

      const amount = cycle.suggestedAmountCents;

      tx.update(schema.payoutCycles)
        .set({
          status: 'paid',
          actualAmountCents: amount,
          reviewedAt: now,
          reviewedBy: parentPersonId,
          note: note ?? null,
        })
        .where(eq(schema.payoutCycles.id, id))
        .run();

      if (amount > 0) {
        tx.insert(schema.ledgerEntries)
          .values({
            id: crypto.randomUUID(),
            kidId: cycle.kidId,
            kind: 'payout',
            amountCents: amount,
            description:
              note?.trim() || `Weekly allowance (week of ${cycle.weekStarting})`,
            visibleToKid: true,
            createdAt: now,
            createdBy: parentPersonId,
            relatedPayoutCycleId: id,
          })
          .run();
      }

      count++;
    }
  });

  return count;
}

/** Skip several weeks at once. No ledger entries. Returns how many were skipped. */
export async function skipPayoutBatch(
  familyId: string,
  parentPersonId: string,
  cycleIds: string[],
  note?: string
): Promise<number> {
  if (cycleIds.length === 0) return 0;
  await assertCyclesInFamily(familyId, cycleIds);

  const now = Date.now();
  let count = 0;

  db.transaction((tx) => {
    for (const id of cycleIds) {
      const cycle = tx
        .select()
        .from(schema.payoutCycles)
        .where(eq(schema.payoutCycles.id, id))
        .limit(1)
        .all()[0];
      if (!cycle) continue;
      if (cycle.status === 'paid' || cycle.status === 'skipped') continue;

      tx.update(schema.payoutCycles)
        .set({
          status: 'skipped',
          actualAmountCents: 0,
          reviewedAt: now,
          reviewedBy: parentPersonId,
          note: note ?? null,
        })
        .where(eq(schema.payoutCycles.id, id))
        .run();

      count++;
    }
  });

  return count;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/server/payout-batch.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/payouts.ts src/lib/server/payout-batch.test.ts
git commit -m "feat(payouts): transactional batch approve/skip for queued weeks"
```

---

### Task 5: Wire the review route

`load` returns the bucketed queue; two new actions handle the bulk buttons.

**Files:**
- Modify: `src/routes/review/+page.server.ts`
- Test: `src/routes/review/review-load.test.ts` (create)

**Interfaces:**
- Consumes: `getReviewQueue`, `approvePayoutBatch`, `skipPayoutBatch` (Tasks 3–4).
- Produces: `load` returns `{ queue: ReviewQueue }` (was `{ items }`). Actions `approve`, `skip`, `approveAll`, `skipAll`. The bulk actions read repeated `cycleId` fields via `data.getAll('cycleId')` and return `{ ok: true, count }`.

- [ ] **Step 1: Write the failing test**

Create `src/routes/review/review-load.test.ts`, modeled on the existing `src/routes/leaderboard/leaderboard-load.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { seedFamily, seedKid } from '$lib/server/test/seed';
import { getReviewQueue } from '$lib/server/payouts';
import { todayIso, parseIsoDate } from '$lib/server/dates';

function weeksAgoMs(n: number): number {
  const d = parseIsoDate(todayIso());
  d.setDate(d.getDate() - n * 7);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

describe('review page data', () => {
  it('returns a queue with all three buckets populated after a long gap', async () => {
    const fam = seedFamily('Route Fam', { createdAt: weeksAgoMs(6) });
    seedKid(fam, 'Amy', '2016-01-01', { createdAt: weeksAgoMs(6) });

    const queue = await getReviewQueue(fam);

    expect(queue.current).toHaveLength(1);
    expect(queue.recent).toHaveLength(2);
    expect(queue.older).toHaveLength(4);
    // Every item carries what the card needs to render.
    for (const item of [...queue.current, ...queue.recent, ...queue.older]) {
      expect(item.cycleId).toBeTruthy();
      expect(item.kidName).toBe('Amy');
      expect(item.weekStarting).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.suggestedAmountCents).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/routes/review/review-load.test.ts`
Expected: PASS.

This one is a regression guard rather than a red-then-green cycle — it pins the data contract the route depends on (`getReviewQueue` already exists from Task 3), so that a later change to bucketing can't silently break the page. If it fails here, Task 3 is incomplete; fix that before continuing.

- [ ] **Step 3: Rewrite the route**

Replace the entire contents of `src/routes/review/+page.server.ts`:

```ts
// /review — parent-only. Weekly review: per-kid summary + approve/skip.
//
// The queue includes every unreviewed week, not just the current one — a missed
// review is deferred, never lost. Older weeks collapse into one bulk-actionable
// group so a long absence doesn't produce a wall of cards.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import {
  getReviewQueue,
  approvePayout,
  skipPayout,
  approvePayoutBatch,
  skipPayoutBatch,
} from '$lib/server/payouts';
import { requireFreshPin } from '$lib/server/pinGuard';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.session) throw redirect(303, '/claim');
  if (locals.session.role !== 'parent') throw error(403, 'Parents only');
  await requireFreshPin(locals.session, '/review');
  const queue = await getReviewQueue(locals.session.familyId);
  return { queue };
};

export const actions: Actions = {
  approve: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const data = await request.formData();
    const cycleId = data.get('cycleId')?.toString();
    const amountStr = data.get('amountCents')?.toString();
    const note = data.get('note')?.toString();
    if (!cycleId || !amountStr) return fail(400, { error: 'Missing fields' });
    const amount = parseInt(amountStr, 10);
    if (Number.isNaN(amount) || amount < 0) return fail(400, { error: 'Bad amount' });

    try {
      await approvePayout(locals.session.personId, cycleId, amount, note);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { ok: true };
  },

  skip: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const data = await request.formData();
    const cycleId = data.get('cycleId')?.toString();
    const note = data.get('note')?.toString();
    if (!cycleId) return fail(400, { error: 'Missing cycleId' });

    try {
      await skipPayout(locals.session.personId, cycleId, note);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { ok: true };
  },

  approveAll: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const data = await request.formData();
    const cycleIds = data.getAll('cycleId').map((v) => v.toString());
    if (cycleIds.length === 0) return fail(400, { error: 'Nothing selected' });

    try {
      const count = await approvePayoutBatch(
        locals.session.familyId,
        locals.session.personId,
        cycleIds
      );
      return { ok: true, count };
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },

  skipAll: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const data = await request.formData();
    const cycleIds = data.getAll('cycleId').map((v) => v.toString());
    if (cycleIds.length === 0) return fail(400, { error: 'Nothing selected' });

    try {
      const count = await skipPayoutBatch(
        locals.session.familyId,
        locals.session.personId,
        cycleIds
      );
      return { ok: true, count };
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },
};
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/routes/review/review-load.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

The Svelte template still reads `data.items` and will not typecheck until Task 6. Commit the server change alone anyway — it is a coherent unit, and Task 6 follows immediately.

```bash
git add src/routes/review/+page.server.ts src/routes/review/review-load.test.ts
git commit -m "feat(review): serve bucketed queue and bulk approve/skip actions"
```

---

### Task 6: Review screen

Extract the per-cycle card into its own component (the markup is now needed in three places), then render the three buckets with a collapsed group for older weeks.

**Files:**
- Create: `src/lib/components/ReviewCard.svelte`
- Modify: `src/routes/review/+page.svelte` (full rewrite)

**Interfaces:**
- Consumes: `data.queue` from Task 5; the `WeeklyReviewItem` type from `$lib/server/payouts`.
- Produces: `ReviewCard` with a single prop `item: WeeklyReviewItem`. It owns its own adjust-mode state and posts to the existing `?/approve` and `?/skip` actions.

- [ ] **Step 1: Create the card component**

Create `src/lib/components/ReviewCard.svelte`:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  import type { WeeklyReviewItem } from '$lib/review-types';

  export let item: WeeklyReviewItem;

  let adjusting = false;
  let adjustValue = '';

  function dollars(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }

  function dollarsToCents(s: string): number {
    const n = parseFloat(s);
    if (Number.isNaN(n)) return 0;
    return Math.round(n * 100);
  }

  function startAdjust() {
    adjustValue = (item.suggestedAmountCents / 100).toFixed(2);
    adjusting = true;
  }

  function weekLabel(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // A cycle stays actionable until it is finalized. 'reviewed' is currently
  // unreachable, but gating on 'open' alone would strand it if it ever isn't.
  $: actionable = item.status !== 'paid' && item.status !== 'skipped';
</script>

<article class="rounded-xl border border-slate-200 bg-white p-4">
  <header class="flex items-center justify-between">
    <div>
      <div class="font-medium text-lg">{item.kidName}</div>
      <div class="text-xs text-slate-500">
        Age {item.age} · Week of {weekLabel(item.weekStarting)}
      </div>
    </div>
    {#if item.status === 'paid'}
      <span class="rounded-full bg-green-100 text-green-800 text-xs font-medium px-3 py-1">
        Paid {dollars(item.actualAmountCents ?? 0)}
      </span>
    {:else if item.status === 'skipped'}
      <span class="rounded-full bg-slate-200 text-slate-700 text-xs font-medium px-3 py-1">
        Skipped
      </span>
    {/if}
  </header>

  <div class="mt-3 text-sm">
    <span class="font-medium">{item.confirmedCount} of {item.totalCount}</span>
    <span class="text-slate-500"> chores this week</span>
    {#if item.missedChoreNames.length > 0 && actionable}
      <div class="mt-1 text-xs text-amber-700">
        Missed: {item.missedChoreNames.join(', ')}
      </div>
    {/if}
  </div>

  {#if actionable}
    {#if adjusting}
      <form method="POST" action="?/approve" use:enhance class="mt-4 space-y-2">
        <input type="hidden" name="cycleId" value={item.cycleId} />
        <input type="hidden" name="amountCents" value={dollarsToCents(adjustValue)} />
        <label class="block">
          <span class="text-sm font-medium">Amount</span>
          <div class="mt-1 flex items-center gap-2">
            <span class="text-lg">$</span>
            <input
              type="number"
              step="0.25"
              min="0"
              bind:value={adjustValue}
              class="flex-1 rounded border border-slate-300 p-2 text-lg"
            />
          </div>
        </label>
        <label class="block">
          <span class="text-sm font-medium">Note (optional)</span>
          <input
            type="text"
            name="note"
            class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm"
            placeholder="e.g. great week"
          />
        </label>
        <div class="flex gap-2">
          <button
            type="submit"
            class="flex-1 rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-2 font-medium"
          >
            Approve {dollars(dollarsToCents(adjustValue))}
          </button>
          <button
            type="button"
            on:click={() => (adjusting = false)}
            class="rounded-lg bg-slate-200 hover:bg-slate-300 px-4 py-2 text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    {:else}
      <div class="mt-4 grid grid-cols-3 gap-2">
        <form method="POST" action="?/approve" use:enhance>
          <input type="hidden" name="cycleId" value={item.cycleId} />
          <input type="hidden" name="amountCents" value={item.suggestedAmountCents} />
          <button
            class="w-full rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-3 font-medium"
          >
            Approve {dollars(item.suggestedAmountCents)}
          </button>
        </form>
        <button
          type="button"
          on:click={startAdjust}
          class="rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 py-3 text-sm font-medium"
        >
          Adjust
        </button>
        <form method="POST" action="?/skip" use:enhance>
          <input type="hidden" name="cycleId" value={item.cycleId} />
          <button
            class="w-full rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 py-3 text-sm font-medium"
          >
            Skip
          </button>
        </form>
      </div>
    {/if}
  {/if}
</article>
```

- [ ] **Step 2: Rewrite the review page**

Replace the entire contents of `src/routes/review/+page.svelte`:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  import ReviewCard from '$lib/components/ReviewCard.svelte';
  import type { PageData } from './$types';

  export let data: PageData;

  let expandedOlder = false;

  function dollars(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }

  function weekLabel(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  $: olderWeekCount = new Set(data.queue.older.map((i) => i.weekStarting)).size;
  $: olderTotalCents = data.queue.older.reduce((s, i) => s + i.suggestedAmountCents, 0);
  $: nothingToDo =
    data.queue.current.length === 0 &&
    data.queue.recent.length === 0 &&
    data.queue.older.length === 0;
</script>

<svelte:head>
  <title>Weekly review</title>
</svelte:head>

<header class="flex items-center justify-between">
  <h1 class="text-2xl font-semibold">Weekly review</h1>
  <a href="/" class="text-sm text-slate-500 hover:text-slate-800 underline">← Home</a>
</header>

{#if nothingToDo}
  <p class="mt-6 text-slate-500">Nothing to review — you're all caught up.</p>
{/if}

{#if data.queue.current.length > 0}
  <section class="mt-6">
    <h2 class="text-sm font-medium uppercase tracking-wide text-slate-500">This week</h2>
    <div class="mt-2 space-y-4">
      {#each data.queue.current as item (item.cycleId)}
        <ReviewCard {item} />
      {/each}
    </div>
  </section>
{/if}

{#if data.queue.recent.length > 0}
  <section class="mt-8">
    <h2 class="text-sm font-medium uppercase tracking-wide text-amber-700">
      Waiting on you
    </h2>
    <div class="mt-2 space-y-4">
      {#each data.queue.recent as item (item.cycleId)}
        <ReviewCard {item} />
      {/each}
    </div>
  </section>
{/if}

{#if data.queue.older.length > 0}
  <section class="mt-8">
    <h2 class="text-sm font-medium uppercase tracking-wide text-slate-500">Earlier</h2>

    <div class="mt-2 rounded-xl border border-slate-200 bg-white p-4">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-medium">
            {olderWeekCount} earlier week{olderWeekCount === 1 ? '' : 's'} · {dollars(
              olderTotalCents
            )}
          </div>
          <div class="text-xs text-slate-500">
            Back to week of {weekLabel(
              data.queue.older[data.queue.older.length - 1].weekStarting
            )}
          </div>
        </div>
        <button
          type="button"
          on:click={() => (expandedOlder = !expandedOlder)}
          class="text-sm text-slate-500 hover:text-slate-800 underline"
        >
          {expandedOlder ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {#if !expandedOlder}
        <div class="mt-4 grid grid-cols-2 gap-2">
          <form method="POST" action="?/approveAll" use:enhance>
            {#each data.queue.older as item (item.cycleId)}
              <input type="hidden" name="cycleId" value={item.cycleId} />
            {/each}
            <button
              class="w-full rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-3 font-medium"
            >
              Approve all {dollars(olderTotalCents)}
            </button>
          </form>
          <form method="POST" action="?/skipAll" use:enhance>
            {#each data.queue.older as item (item.cycleId)}
              <input type="hidden" name="cycleId" value={item.cycleId} />
            {/each}
            <button
              class="w-full rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 py-3 text-sm font-medium"
            >
              Skip all
            </button>
          </form>
        </div>
      {/if}
    </div>

    {#if expandedOlder}
      <div class="mt-4 space-y-4">
        {#each data.queue.older as item (item.cycleId)}
          <ReviewCard {item} />
        {/each}
      </div>
    {/if}
  </section>
{/if}
```

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: no errors in `src/routes/review/` or `src/lib/components/ReviewCard.svelte`.

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`

Seed a backlog by hand if the dev DB has none — open `npm run db:studio` and set an existing kid's `persons.created_at` back six weeks, then delete that kid's `payout_cycles` rows. Reload `/review` and confirm:
- "This week" shows one card per kid.
- "Waiting on you" shows two weeks of cards.
- "Earlier" shows a single row with a week count and total, Approve all / Skip all buttons, and an Expand toggle that reveals individual cards.
- Approve all clears the group and creates one ledger row per week (check `/me/history` or db:studio).

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/ReviewCard.svelte src/routes/review/+page.svelte
git commit -m "feat(review): render queued weeks with collapsible bulk-action group"
```

---

### Task 7: Payout-day reminder push

A daily timer that, on the family's `payoutDay`, pushes a summary if anything is outstanding.

The scheduler gets its own module rather than living in `payouts.ts` — matching `backup.ts` and `scoreboard-sync.ts`, which each own their scheduler. (The spec placed it in `payouts.ts`; this follows the established pattern instead.)

**Files:**
- Create: `src/lib/server/review-nudge.ts`
- Create: `src/lib/server/review-nudge.test.ts`
- Modify: `src/hooks.server.ts`

**Interfaces:**
- Consumes: `getReviewQueue` (Task 3); `sendToFamilyParents` and `PushPayload` from `push.ts`; `todayIso`, `dayOfWeek` from `dates.ts`; `centsToDollars` from `payout-config.ts`.
- Produces:
  - `type PushSender = (familyId: string, payload: PushPayload) => Promise<void>`
  - `sendReviewNudges(nowIso?: string, send?: PushSender): Promise<number>` — returns how many families were pushed. Both parameters are injectable so tests need no module mocking.
  - `scheduleWeeklyReviewNudge(): void`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/review-nudge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import { seedFamily, seedKid } from '$lib/server/test/seed';
import { sendReviewNudges } from '$lib/server/review-nudge';
import { collectReviewItems, approvePayoutBatch } from '$lib/server/payouts';
import { todayIso, dayOfWeek, parseIsoDate, toIsoDate } from '$lib/server/dates';

function weeksAgoMs(n: number): number {
  const d = parseIsoDate(todayIso());
  d.setDate(d.getDate() - n * 7);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

/** An ISO date whose weekday is `dow` (0=Sun), within the current week. */
function isoForWeekday(dow: number): string {
  const d = parseIsoDate(todayIso());
  d.setDate(d.getDate() - ((d.getDay() - dow + 7) % 7));
  return toIsoDate(d);
}

function recorder() {
  const sent: { familyId: string; title: string; body: string; url?: string }[] = [];
  const send = async (familyId: string, payload: any) => {
    sent.push({ familyId, ...payload });
  };
  return { sent, send };
}

describe('sendReviewNudges', () => {
  it('pushes on the family payout day when weeks are outstanding', async () => {
    const sunday = isoForWeekday(0);
    const fam = seedFamily('Nudge Fam', { createdAt: weeksAgoMs(3), payoutDay: 0 });
    seedKid(fam, 'Amy', '2016-01-01', { createdAt: weeksAgoMs(3) });

    const { sent, send } = recorder();
    const count = await sendReviewNudges(sunday, send);

    expect(count).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].familyId).toBe(fam);
    expect(sent[0].url).toBe('/review');
    expect(sent[0].body).toContain('1 kid');
  });

  it('does not push on a day that is not the payout day', async () => {
    const fam = seedFamily('Wrong Day Fam', { createdAt: weeksAgoMs(3), payoutDay: 0 });
    seedKid(fam, 'Ben', '2016-01-01', { createdAt: weeksAgoMs(3) });

    const { sent, send } = recorder();
    // Wednesday, family pays out Sunday.
    expect(await sendReviewNudges(isoForWeekday(3), send)).toBe(0);
    expect(sent).toEqual([]);
  });

  it('honors a non-default payout day', async () => {
    const fam = seedFamily('Friday Fam', { createdAt: weeksAgoMs(3), payoutDay: 5 });
    seedKid(fam, 'Cal', '2016-01-01', { createdAt: weeksAgoMs(3) });

    const { sent, send } = recorder();
    expect(await sendReviewNudges(isoForWeekday(5), send)).toBe(1);
    expect(sent[0].familyId).toBe(fam);
  });

  it('does not push when the queue is empty', async () => {
    const sunday = isoForWeekday(0);
    const fam = seedFamily('Caught Up Fam', { createdAt: weeksAgoMs(2), payoutDay: 0 });
    const parent = crypto.randomUUID();
    db.insert(schema.persons)
      .values({ id: parent, familyId: fam, name: 'P', role: 'parent', createdAt: Date.now() })
      .run();
    seedKid(fam, 'Dee', '2016-01-01', { createdAt: weeksAgoMs(2) });

    const items = await collectReviewItems(fam);
    await approvePayoutBatch(fam, parent, items.map((i) => i.cycleId));

    const { sent, send } = recorder();
    expect(await sendReviewNudges(sunday, send)).toBe(0);
    expect(sent).toEqual([]);
  });

  it('does not push for a family with no kids', async () => {
    seedFamily('Kidless Fam', { createdAt: weeksAgoMs(3), payoutDay: 0 });
    const { sent, send } = recorder();
    expect(await sendReviewNudges(isoForWeekday(0), send)).toBe(0);
    expect(sent).toEqual([]);
  });

  it('keeps going when one family push throws', async () => {
    const sunday = isoForWeekday(0);
    const famA = seedFamily('Boom Fam', { createdAt: weeksAgoMs(3), payoutDay: 0 });
    seedKid(famA, 'Eli', '2016-01-01', { createdAt: weeksAgoMs(3) });
    const famB = seedFamily('Fine Fam', { createdAt: weeksAgoMs(3), payoutDay: 0 });
    seedKid(famB, 'Fay', '2016-01-01', { createdAt: weeksAgoMs(3) });

    const ok: string[] = [];
    const send = async (familyId: string) => {
      if (familyId === famA) throw new Error('push exploded');
      ok.push(familyId);
    };

    const count = await sendReviewNudges(sunday, send);
    expect(count).toBe(1);
    expect(ok).toEqual([famB]);
  });

  it('summarizes kid count and total across siblings', async () => {
    const sunday = isoForWeekday(0);
    const fam = seedFamily('Two Kid Fam', { createdAt: weeksAgoMs(1), payoutDay: 0 });
    seedKid(fam, 'Gus', '2016-01-01', { createdAt: weeksAgoMs(1) });
    seedKid(fam, 'Hal', '2016-01-01', { createdAt: weeksAgoMs(1) });

    const items = await collectReviewItems(fam);
    const total = items.reduce((s, i) => s + i.suggestedAmountCents, 0);

    const { sent, send } = recorder();
    await sendReviewNudges(sunday, send);

    expect(sent[0].body).toContain('2 kids');
    expect(sent[0].body).toContain(`$${(total / 100).toFixed(2)}`);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/server/review-nudge.test.ts`
Expected: FAIL — cannot resolve `$lib/server/review-nudge`.

- [ ] **Step 3: Implement the nudge module**

Create `src/lib/server/review-nudge.ts`:

```ts
// Payout-day reminder push.
//
// The review queue is what prevents money being lost; this reminder just keeps a
// backlog from forming in the first place. It fires once, on the family's chosen
// payoutDay — deliberately not daily, because a nagging channel is a muted
// channel, and muting would take the chore-done alerts with it.
//
// Server off at 18:00 on payout day means no nudge that week. That's acceptable:
// the queue is the safety net, not this.

import { db, schema } from './db';
import { todayIso, dayOfWeek } from './dates';
import { getReviewQueue } from './payouts';
import { centsToDollars } from './payout-config';
import { sendToFamilyParents, type PushPayload } from './push';

export type PushSender = (familyId: string, payload: PushPayload) => Promise<void>;

/**
 * Push a review reminder to every family whose payoutDay is `nowIso`'s weekday
 * and whose queue is non-empty. Returns how many families were pushed.
 *
 * `nowIso` and `send` are injectable so tests don't need to mock modules or
 * freeze the clock.
 */
export async function sendReviewNudges(
  nowIso: string = todayIso(),
  send: PushSender = sendToFamilyParents
): Promise<number> {
  const dow = dayOfWeek(nowIso);
  const families = await db
    .select({ id: schema.families.id, payoutDay: schema.families.payoutDay })
    .from(schema.families);

  let sent = 0;

  for (const fam of families) {
    if (fam.payoutDay !== dow) continue;

    const queue = await getReviewQueue(fam.id);
    const outstanding = [...queue.current, ...queue.recent, ...queue.older];
    if (outstanding.length === 0) continue;

    const kidCount = new Set(outstanding.map((i) => i.kidId)).size;
    const totalCents = outstanding.reduce((s, i) => s + i.suggestedAmountCents, 0);

    try {
      await send(fam.id, {
        title: 'Weekly review ready',
        body: `${kidCount} kid${kidCount === 1 ? '' : 's'} · $${centsToDollars(
          totalCents
        )} suggested`,
        url: '/review',
        tag: 'weekly-review',
      });
      sent++;
    } catch (e) {
      // One family's dead push endpoint must not stop the others.
      console.error('[review-nudge] push failed:', e);
    }
  }

  return sent;
}

function msUntilNext(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function scheduleWeeklyReviewNudge(): void {
  const existing = (globalThis as any).__allowanceReviewNudgeScheduler__;
  if (existing?.timer) clearTimeout(existing.timer);
  const state = { timer: null as NodeJS.Timeout | null };
  (globalThis as any).__allowanceReviewNudgeScheduler__ = state;

  function arm() {
    // 6pm — evening, when a parent can actually act on it.
    state.timer = setTimeout(async () => {
      try {
        const sent = await sendReviewNudges();
        if (sent > 0) console.log(`[review-nudge] pushed ${sent} reminder(s)`);
      } catch (e) {
        console.error('[review-nudge] run errored:', e);
      }
      arm(); // reschedule for tomorrow
    }, msUntilNext(18));
  }
  arm();
  console.log('[review-nudge] scheduler armed');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/server/review-nudge.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Register the scheduler**

In `src/hooks.server.ts`, add the import beside the others:

```ts
import { scheduleWeeklyReviewNudge } from '$lib/server/review-nudge';
```

and add the call to the boot-time block, after `scheduleNightlySummaryPush()`:

```ts
scheduleWeeklyReviewNudge();
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test`
Expected: PASS, all suites.

Run: `npm run check`
Expected: no errors.

- [ ] **Step 7: Verify the scheduler arms on boot**

Run: `npm run dev`, then load any page.
Expected: `[review-nudge] scheduler armed` in the server console alongside the existing `[backup]` and `[scoreboard-sync]` lines.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/review-nudge.ts src/lib/server/review-nudge.test.ts src/hooks.server.ts
git commit -m "feat(review): payout-day reminder push for outstanding reviews"
```

---

## Spec Coverage

| Spec requirement | Task |
|---|---|
| No schema change | Global constraint; no migration in any task |
| Lazy backfill on read | Task 2 |
| Floor at `max(kid.createdAt, family.createdAt)` | Task 2, Step 4 |
| Age as of each week's end | Task 2, Step 4 + test |
| Past amounts frozen; current week refreshed | Task 2, Step 4 + two tests |
| Per-week chore counts | Task 2, Step 4 + test |
| `paid`/`skipped` excluded, `open`/`reviewed` included | Task 2 (exclusion), Task 6 `actionable` gate (inclusion) |
| `current`/`recent`/`older` return shape, all arrays | Task 3 |
| Bucketing by week, not by kid | Task 3 + test |
| `DETAIL_WEEKS = 2` as a constant | Task 3 |
| `getCurrentWeekReview` removed | Task 3, Steps 4 + 7 |
| Batch approve at each cycle's own amount | Task 4 + test |
| Batch is transactional; double-tap is a no-op | Task 4 + test |
| Batch returns actual count | Task 4 |
| Family-ownership check on batch ids | Task 4 `assertCyclesInFamily` + tests |
| Unknown batch id skipped, not an error | Task 4 `assertCyclesInFamily` + test |
| Already-finalized batch id skipped silently | Task 4 loop guard + double-tap test |
| Route load returns buckets; `approveAll`/`skipAll` via `getAll('cycleId')` | Task 5 |
| Collapsed older row with bulk buttons + expand | Task 6 |
| Card gate is `!== 'paid' && !== 'skipped'` | Task 6, `ReviewCard.svelte` |
| Nudge on `payoutDay`, only when outstanding | Task 7 + tests |
| Nudge failure never breaks the re-arm | Task 7, try/catch in both `sendReviewNudges` and `arm()` + test |
| Registered in `hooks.server.ts` | Task 7, Step 5 |
| Kid-facing UI unchanged | Global constraint; no task touches kid routes |
| Missing birthdate → age 0 | Task 2, Step 4 (`kid.birthdate ? ... : 0`) |
