# Queued Payout Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the queued-review feature: remove the backfill cap and the chore-activity gate, freeze past-week amounts, add bucketing and bulk approve/skip, and rework the reminder to fire once on the family's payout day.

**Architecture:** This plan is a **revision on top of commit `a036abb`**, not a from-scratch build. That commit already replaced the single-week read path with `getWeeklyReview(familyId, includePastWeeks)`, decomposed into `loadFamily` / `loadKids` / `earliestWeekFor` / `instancesByWeek` / `cyclesByWeek` / `outstandingWeeksFor` / `ensureCycle` / `buildItem`, added `countMissedWeeks`, and added a daily `review-reminder.ts` scheduler. We keep that structure and change four behaviors, then add the two things it lacks (bucketing + bulk actions).

**Tech Stack:** SvelteKit 2 (Svelte 4), TypeScript, Drizzle ORM over better-sqlite3, Vitest, Tailwind, web-push.

**Spec:** `docs/superpowers/specs/2026-08-29-queued-payout-review-design.md`

**Baseline:** branch `feat/queued-payout-review` at `a036abb`. Verified green before starting: 18 test files, 96 tests.

## What the baseline already does right — do not undo

- `getWeeklyReview(familyId, includePastWeeks = true)` with `getCurrentWeekReview` retained as the `includePastWeeks = false` wrapper. **`src/lib/server/leaderboard.ts:118` calls `getCurrentWeekReview`** — a kid-visible read path that must never materialize past cycles as a side effect. Two baseline tests pin this; keep them passing.
- `countMissedWeeks` is read-only and creates nothing. A baseline test pins that. Keep it.
- Past weeks are valued at the kid's age during that week (`asOf = wkEnd < today ? wkEnd : today`).
- `weeksAgo` on `WeeklyReviewItem`, and the `weeksFromThrough` / `addWeeks` / `addDays` date helpers.
- The `$env/dynamic/private` test stub in `vitest.config.ts`.

## Global Constraints

- **No schema change.** No Drizzle migration in this plan.
- **All money is integer cents.** Never floats.
- **Dates without a time are ISO `YYYY-MM-DD` local strings**; they compare correctly with `<`, `>`, `localeCompare`.
- **Timestamps are integer epoch milliseconds.**
- **Weeks stay Mon–Sun** via `weekStarting()` / `weekEnding()`.
- **better-sqlite3 transactions are synchronous.** Inside `db.transaction((tx) => {...})` use `.all()` / `.get()` / `.run()`, never `await`.
- **Kid-facing UI is out of scope.** No task touches kid routes.
- Run tests with `npm test`. Full suite must be green at the end of every task.

## Expected behavior change on first load

Removing the cap and the activity gate means the first `/review` load after deploy surfaces **every week back to each kid's join date**, not just weeks with chore activity in the last 8. For a family running a year, that is ~52 weeks per kid in the `older` bucket. This is the intended design (nothing is ever lost, older weeks collapse into one row) — but it is a large, visible, one-time change, and "Approve all" on that group would pay out a year of back allowance in one tap. Task 5's UI shows the week count and dollar total on the group before any action, which is what makes that safe.

---

### Task 1: Unbounded backfill, no activity gate

Two behavior reversals in one task — they touch the same function and the same tests, and splitting them would leave the suite red in between.

**Files:**
- Modify: `src/lib/server/payouts.ts`
- Modify: `src/lib/server/payouts-missed-weeks.test.ts`
- Modify: `src/lib/server/review-reminder.test.ts`

**Interfaces:**
- Consumes: baseline `getWeeklyReview`, `countMissedWeeks`, `outstandingWeeksFor`, `earliestWeekFor`.
- Produces: same signatures. `MAX_BACKFILL_WEEKS` is **removed** (it is exported and imported by the test file — remove both).

**Floor rule:** the week the kid was added, with no window cap. The spec says `max(kid.createdAt, family.createdAt)`; use `kid.createdAt` alone. A `persons` row cannot predate its `families` row (foreign key), so the two can only differ on corrupt data, and taking the max would cost an extra selected column plus a rewrite of every `seedFamily()` call in the suite for no production difference. Deliberate deviation, recorded here.

- [ ] **Step 1: Replace the two gating functions**

In `src/lib/server/payouts.ts`, delete the `MAX_BACKFILL_WEEKS` constant and replace `earliestWeekFor` and `outstandingWeeksFor` with:

```ts
/** The oldest week we look back to for this kid: the week they were added.
 *  No window cap — a week is owed whether or not anyone opened the app that
 *  month, so capping it would re-introduce the expiry this feature removes. */
function earliestWeekFor(kid: KidRow, currentWeek: string, includePast: boolean): string {
  if (!includePast) return currentWeek;
  return weekStarting(toIsoDate(new Date(kid.createdAt)));
}
```

```ts
/**
 * Weeks this kid still needs reviewed, oldest first, always ending with the
 * current week. Every week since they joined counts until it's finalized:
 * allowance here is age-based, only loosely tied to chores, so a quiet stretch
 * (server off, chores paused, none configured yet) still owes the kid a week.
 */
function outstandingWeeksFor(
  kid: KidRow,
  currentWeek: string,
  cycles: Map<string, PayoutCycle>,
  includePast: boolean
): string[] {
  return weeksFromThrough(earliestWeekFor(kid, currentWeek, includePast), currentWeek).filter(
    (wk) => wk === currentWeek || !isFinalized(cycles.get(wk)?.status)
  );
}
```

`instances` is no longer a parameter. Update both call sites — in `getWeeklyReview` and in `countMissedWeeks` — to drop that argument.

In `countMissedWeeks`, the `instancesByWeek` call now feeds nothing; delete it and its `Promise.all`, leaving:

```ts
    const from = earliestWeekFor(kid, currentWeek, true);
    const cycles = await cyclesByWeek(kid.id, from);
    for (const wk of outstandingWeeksFor(kid, currentWeek, cycles, true)) {
      if (wk !== currentWeek) weeks.add(wk);
    }
```

`countMissedWeeks` must still create nothing — a baseline test pins that.

- [ ] **Step 2: Update the file header comment**

Replace the paragraph beginning "Weeks are never silently dropped." with:

```
// Weeks are never silently dropped. A parent who forgets to review a week finds
// that week still waiting the next time they open /review: getWeeklyReview walks
// back to the week each kid was added, materializes a cycle for every week that
// was never finalized, and returns those alongside the current week. There is no
// cap and no "did anything happen that week" filter — either would re-create the
// expiry this exists to remove. Backdated weeks are valued as of the week they
// cover (the kid's age then, not today's), so a birthday in between doesn't
// inflate an old week.
```

- [ ] **Step 3: Update the tests that encoded the old rules**

In `src/lib/server/payouts-missed-weeks.test.ts`:

Drop `MAX_BACKFILL_WEEKS` from the import list. Replace the `MONTHS_AGO` constant and `seedOldKid` helper with a helper that pins the window explicitly — now that the join date is the only floor, every test must state how far back its kid goes:

```ts
/** A kid who joined `weeksAgo` weeks ago, so the backfill window is exactly that wide. */
function seedKidJoined(
  familyId: string,
  name: string,
  weeksAgo: number,
  birthdate = '2016-01-01'
): string {
  const joined = addWeeks(thisWeek, -weeksAgo);
  return seedKid(familyId, name, birthdate, new Date(`${joined}T12:00:00`).getTime());
}
```

Then rework each test as follows. Every `seedOldKid(fam, 'X')` call becomes `seedKidJoined(fam, 'X', N)` with N chosen to make the expected window explicit:

| Test | Change |
|---|---|
| `surfaces a past week whose cycle was left open, oldest first` | `seedKidJoined(fam, 'Ana', 2)`. Expectation `[twoWeeksAgo, lastWeek, thisWeek]` now holds because the join date bounds it. |
| `backfills a week that has chore activity but no cycle at all` | `seedKidJoined(fam, 'Bo', 2)`. Assertions are `find`-based; they still hold. |
| `ignores a past week the app tracked nothing in` | **Invert.** Rename to `surfaces a past week even when nothing was tracked in it`; `seedKidJoined(fam, 'Cy', 2)`; expect `[twoWeeksAgo, lastWeek, thisWeek]`. |
| `drops a past week once it is paid or skipped` | `seedKidJoined(fam, 'Dee', 2)`; expect `[thisWeek]` (both past weeks finalized). |
| `keeps a past week that was reviewed but never finalized` | `seedKidJoined(fam, 'Eli', 1)`; expect `[lastWeek, thisWeek]`. |
| `stops at the backfill window` | **Delete and replace** with the test below. |
| `never looks back past the week the kid was added` | Keep the setup; expectation becomes `[addWeeks(thisWeek, -3), addWeeks(thisWeek, -2), lastWeek, thisWeek]` — the `-5` cycle stays excluded, the gap weeks now appear. |
| `counts each kid-week separately but reports one row per kid per week` | `seedKidJoined(fam, 'Hana', 1)` / `seedKidJoined(fam, 'Ivo', 1)`. Filter-based; holds. |
| `values a past week at the age the kid was that week` | `seedKidJoined(fam, 'Jae', 1, birthdate)`. `find`-based; holds. |
| `rewrites a stale suggestion stored on a still-open past cycle` | Leave as-is here — **Task 2 inverts it.** |
| `counts only that week's chores against a past week` | `seedKidJoined(fam, 'Lia', 1)`. `find`-based; holds. |
| `approving it pays the kid and labels the ledger with that week` | `seedKidJoined(fam, 'Mo', 1)`; the trailing `expect(after...).toEqual([thisWeek])` then holds. |
| `skipping it closes the week without a ledger entry` | `seedKidJoined(fam, 'Nia', 1)`; same. |
| `counts distinct earlier weeks and ignores the week in progress` | `seedKidJoined(fam, 'Oz', 2)` / `seedKidJoined(fam, 'Pia', 2)`; still 2. |
| `is zero when only the current week is open` | `seedKidJoined(fam, 'Quin', 0)` — joined this week, so no earlier weeks exist. |
| `creates nothing — it only reports` | `seedKidJoined(fam, 'Rae', 1)`; still 1. |
| `still returns only the week in progress` | `seedKidJoined(fam, 'Sol', 1)`; unaffected (`includePastWeeks = false`). |
| `does not backfill old cycles as a side effect` | `seedKidJoined(fam, 'Tam', 1)`; unaffected. |

Replacing the deleted window test:

```ts
  it('recovers a week far older than the eight-week window used to allow', async () => {
    const fam = seedFamily();
    const kid = seedKidJoined(fam, 'Fay', 12);
    const longAgo = addWeeks(thisWeek, -11);
    seedCycle(kid, longAgo, 'open');

    const items = await getWeeklyReview(fam);
    expect(items.map((i) => i.weekStarting)).toContain(longAgo);
    // Every week since they joined is present: 12 weeks ago through this week.
    expect(items).toHaveLength(13);
  });
```

In `src/lib/server/review-reminder.test.ts`, apply the same treatment: replace `MONTHS_AGO` with an explicit join week.

- `nudges only families with an unreviewed earlier week` — the "Behind" family's kid joins 1 week ago and has an open `lastWeek` cycle; the "Up to date" family's kid joins **this** week (`seedKid(uptodate, 'Bo', '2016-01-01', Date.now())`), so it has no earlier weeks. Still expects `1`.
- `stays quiet when nothing is overdue` — kid joins this week: `seedKid(fam, 'Cy', '2016-01-01', Date.now())`. Still expects `0`.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS, 18 files. Test count rises by 0 (one deleted, one added).

If `payouts.test.ts` or `members-filtering.test.ts` fail: those call `getCurrentWeekReview`, which is unaffected by this task. A failure there means the `includePastWeeks = false` short-circuit in `earliestWeekFor` was dropped — restore it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/payouts.ts src/lib/server/payouts-missed-weeks.test.ts src/lib/server/review-reminder.test.ts
git commit -m "feat(payouts): recover every unreviewed week, not just recent active ones"
```

---

### Task 2: Freeze past-week suggestions

The baseline refreshes any `open` cycle's stored amount. That silently revalues history when the family's payout scheme changes.

**Files:**
- Modify: `src/lib/server/payouts.ts`
- Modify: `src/lib/server/payouts-missed-weeks.test.ts`

**Interfaces:**
- Consumes: baseline `ensureCycle`.
- Produces: `ensureCycle(kid, weekStart, suggested, existing, isCurrentWeek: boolean)` — one new trailing parameter.

- [ ] **Step 1: Write the failing test**

In `src/lib/server/payouts-missed-weeks.test.ts`, replace the test named `rewrites a stale suggestion stored on a still-open past cycle` with:

```ts
  it('leaves a past week’s stored suggestion alone', async () => {
    const fam = seedFamily();
    const kid = seedKidJoined(fam, 'Kit', 1, '2014-01-01');
    seedCycle(kid, lastWeek, 'open', 777); // whatever it was worth then

    const items = await getWeeklyReview(fam);
    const past = items.find((i) => i.weekStarting === lastWeek)!;
    // A past week is history: its amount is frozen once written, so changing
    // the family's payout scheme can't retroactively revalue it.
    expect(past.suggestedAmountCents).toBe(777);

    const stored = (
      await db
        .select()
        .from(schema.payoutCycles)
        .where(eq(schema.payoutCycles.id, past.cycleId))
    )[0];
    expect(stored.suggestedAmountCents).toBe(777);
  });

  it('still refreshes the current week when a birthday lands mid-week', async () => {
    const fam = seedFamily();
    const kid = seedKidJoined(fam, 'Kip', 0, '2014-01-01');
    seedCycle(kid, thisWeek, 'open', 1); // nonsense stored amount

    const items = await getWeeklyReview(fam);
    const current = items.find((i) => i.weekStarting === thisWeek)!;
    expect(current.suggestedAmountCents).toBeGreaterThan(1);
  });
```

- [ ] **Step 2: Run to verify the first test fails**

Run: `npx vitest run src/lib/server/payouts-missed-weeks.test.ts -t "leaves a past week"`
Expected: FAIL — receives the recomputed amount instead of 777.

- [ ] **Step 3: Gate the refresh to the current week**

In `src/lib/server/payouts.ts`, change `ensureCycle`'s signature and its update branch:

```ts
/** Get-or-create the cycle for one kid-week. Only the week in progress has its
 *  suggestion refreshed — a past week's amount is history, and recomputing it
 *  would let a payout-scheme change silently revalue weeks already lived. */
async function ensureCycle(
  kid: KidRow,
  weekStart: string,
  suggested: number,
  existing: PayoutCycle | undefined,
  isCurrentWeek: boolean
): Promise<PayoutCycle> {
  if (!existing) {
    const id = crypto.randomUUID();
    db.insert(schema.payoutCycles)
      .values({
        id,
        kidId: kid.id,
        weekStarting: weekStart,
        status: 'open',
        suggestedAmountCents: suggested,
      })
      .run();
    return (
      await db.select().from(schema.payoutCycles).where(eq(schema.payoutCycles.id, id)).limit(1)
    )[0];
  }
  if (isCurrentWeek && existing.status === 'open' && existing.suggestedAmountCents !== suggested) {
    // Birthday bumped age while the week is still in progress.
    db.update(schema.payoutCycles)
      .set({ suggestedAmountCents: suggested })
      .where(eq(schema.payoutCycles.id, existing.id))
      .run();
    return { ...existing, suggestedAmountCents: suggested };
  }
  return existing;
}
```

In `getWeeklyReview`, pass the flag:

```ts
      const cycle = await ensureCycle(
        kid,
        weekStart,
        suggested,
        cycles.get(weekStart),
        weekStart === currentWeek
      );
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

Note the interaction with `buildItem`: it reads `cycle.suggestedAmountCents`, not the freshly computed `suggested`, so a frozen past week reports its stored amount. The `age` field still reflects age-as-of-that-week, which is correct — it describes the week, not the amount.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/payouts.ts src/lib/server/payouts-missed-weeks.test.ts
git commit -m "fix(payouts): freeze past-week suggestions against scheme changes"
```

---

### Task 3: Bucket the queue

The review screen needs three sections. `getWeeklyReview` stays as the flat producer (the leaderboard depends on it via `getCurrentWeekReview`); bucketing wraps it.

**Files:**
- Create: `src/lib/review-types.ts`
- Modify: `src/lib/server/payouts.ts`
- Test: `src/lib/server/payout-queue.test.ts` (create)

**Interfaces:**
- Consumes: `getWeeklyReview` (baseline, revised by Tasks 1–2).
- Produces:
  - `src/lib/review-types.ts` exporting `WeeklyReviewItem` and `ReviewQueue`
  - `getReviewQueue(familyId: string): Promise<ReviewQueue>`
  - `DETAIL_WEEKS = 2`

**Why the type moves out of `$lib/server`:** Task 5's `ReviewCard.svelte` needs `WeeklyReviewItem` to type its prop, and SvelteKit forbids client code importing from `$lib/server`. Shared types live in `$lib` proper, beside `leaderboard-view.ts` and `cheers.ts`.

- [ ] **Step 1: Move the shared type**

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
  /** 0 = the week in progress, 1 = last week, ... */
  weeksAgo: number;
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

In `src/lib/server/payouts.ts`, delete the local `WeeklyReviewItem` declaration and replace it with a re-export so existing importers keep working:

```ts
import type { WeeklyReviewItem, ReviewQueue } from '$lib/review-types';
export type { WeeklyReviewItem, ReviewQueue };
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/server/payout-queue.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { seedFamily, seedKid } from '$lib/server/test/seed';
import { getReviewQueue } from '$lib/server/payouts';
import { todayIso, weekStarting, addWeeks } from '$lib/server/dates';

const thisWeek = weekStarting(todayIso());

function seedKidJoined(familyId: string, name: string, weeksAgo: number): string {
  const joined = addWeeks(thisWeek, -weeksAgo);
  return seedKid(familyId, name, '2016-01-01', new Date(`${joined}T12:00:00`).getTime());
}

describe('getReviewQueue bucketing', () => {
  it('splits this week, the 2 newest past weeks, and the rest', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Amy', 6);

    const q = await getReviewQueue(fam);

    expect(q.current.map((i) => i.weekStarting)).toEqual([thisWeek]);
    expect(q.recent.map((i) => i.weekStarting)).toEqual([
      addWeeks(thisWeek, -1),
      addWeeks(thisWeek, -2),
    ]);
    expect(q.older.map((i) => i.weekStarting)).toEqual([
      addWeeks(thisWeek, -3),
      addWeeks(thisWeek, -4),
      addWeeks(thisWeek, -5),
      addWeeks(thisWeek, -6),
    ]);
  });

  it('leaves older empty when only two past weeks exist', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Ben', 2);

    const q = await getReviewQueue(fam);
    expect(q.current).toHaveLength(1);
    expect(q.recent).toHaveLength(2);
    expect(q.older).toEqual([]);
  });

  it('buckets by week, keeping siblings together', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Zoe', 4);
    seedKidJoined(fam, 'Abe', 4);

    const q = await getReviewQueue(fam);

    expect(q.current).toHaveLength(2);
    expect(q.recent).toHaveLength(4);
    expect(q.older).toHaveLength(4);
    expect(new Set(q.recent.map((i) => i.weekStarting)).size).toBe(2);
  });

  it('returns empty buckets for a family with no kids', async () => {
    expect(await getReviewQueue(seedFamily())).toEqual({
      current: [],
      recent: [],
      older: [],
    });
  });

  it('orders older newest-week-first', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Cal', 5);

    const q = await getReviewQueue(fam);
    const weeks = q.older.map((i) => i.weekStarting);
    expect(weeks).toEqual([...weeks].sort().reverse());
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/lib/server/payout-queue.test.ts`
Expected: FAIL — `getReviewQueue is not a function`.

- [ ] **Step 4: Implement `getReviewQueue`**

Add to `src/lib/server/payouts.ts`, immediately after `getWeeklyReview`:

```ts
/** Past weeks shown as full cards before the rest collapse into one row. */
export const DETAIL_WEEKS = 2;

/**
 * The review screen's data, bucketed by week (not by kid) so siblings stay side
 * by side and "5 earlier weeks" counts weeks rather than cards.
 *
 * getWeeklyReview returns oldest-first; the screen reads newest-first, so the
 * buckets are reversed here rather than in the template.
 */
export async function getReviewQueue(familyId: string): Promise<ReviewQueue> {
  const items = await getWeeklyReview(familyId);
  const currentWeek = weekStarting(todayIso());

  const current = items.filter((i) => i.weekStarting === currentWeek);
  const past = items
    .filter((i) => i.weekStarting !== currentWeek)
    .sort((a, b) => a.weeksAgo - b.weeksAgo);

  const pastWeeks = [...new Set(past.map((i) => i.weekStarting))].sort().reverse();
  const detail = new Set(pastWeeks.slice(0, DETAIL_WEEKS));

  return {
    current,
    recent: past.filter((i) => detail.has(i.weekStarting)),
    older: past.filter((i) => !detail.has(i.weekStarting)),
  };
}
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS, 19 files.

- [ ] **Step 6: Commit**

```bash
git add src/lib/review-types.ts src/lib/server/payouts.ts src/lib/server/payout-queue.test.ts
git commit -m "feat(payouts): bucket review queue into current/recent/older"
```

---

### Task 4: Transactional batch approve and skip

**Files:**
- Modify: `src/lib/server/payouts.ts`
- Test: `src/lib/server/payout-batch.test.ts` (create)

**Interfaces:**
- Produces:
  - `approvePayoutBatch(familyId, parentPersonId, cycleIds: string[], note?): Promise<number>`
  - `skipPayoutBatch(familyId, parentPersonId, cycleIds: string[], note?): Promise<number>`

  Both return the count actually acted on. Both throw `Error('Cycle not in this family')` if any id belongs to another family. Ids that don't exist are skipped, not an error. Existing `approvePayout` / `skipPayout` are unchanged.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/payout-batch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import { seedFamily, seedKid } from '$lib/server/test/seed';
import { getWeeklyReview, approvePayoutBatch, skipPayoutBatch } from '$lib/server/payouts';
import { todayIso, weekStarting, addWeeks } from '$lib/server/dates';

const thisWeek = weekStarting(todayIso());

function seedKidJoined(familyId: string, name: string, weeksAgo: number): string {
  const joined = addWeeks(thisWeek, -weeksAgo);
  return seedKid(familyId, name, '2016-01-01', new Date(`${joined}T12:00:00`).getTime());
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
    const fam = seedFamily();
    const kid = seedKidJoined(fam, 'Amy', 5);
    const parent = seedParent(fam);

    const items = await getWeeklyReview(fam);
    const expectedTotal = items.reduce((s, i) => s + i.suggestedAmountCents, 0);

    expect(await approvePayoutBatch(fam, parent, items.map((i) => i.cycleId))).toBe(6);

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
    const fam = seedFamily();
    seedKidJoined(fam, 'Ben', 3);
    const parent = seedParent(fam);

    const items = await getWeeklyReview(fam);
    await approvePayoutBatch(fam, parent, items.map((i) => i.cycleId));

    for (const c of await db.select().from(schema.payoutCycles)) {
      expect(c.status).toBe('paid');
      expect(c.actualAmountCents).toBe(c.suggestedAmountCents);
      expect(c.reviewedBy).toBe(parent);
      expect(c.reviewedAt).toBeGreaterThan(0);
    }
  });

  it('makes a double-tap a no-op instead of a double payout', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Cal', 3);
    const parent = seedParent(fam);

    const ids = (await getWeeklyReview(fam)).map((i) => i.cycleId);
    expect(await approvePayoutBatch(fam, parent, ids)).toBe(4);
    expect(await approvePayoutBatch(fam, parent, ids)).toBe(0);
    expect(await db.select().from(schema.ledgerEntries)).toHaveLength(4);
  });

  it('rejects a cycle belonging to another family', async () => {
    const famA = seedFamily('A');
    seedKidJoined(famA, 'Amy', 2);
    const parentA = seedParent(famA);

    const famB = seedFamily('B');
    seedKidJoined(famB, 'Ben', 2);
    const itemsB = await getWeeklyReview(famB);

    await expect(approvePayoutBatch(famA, parentA, [itemsB[0].cycleId])).rejects.toThrow(
      'Cycle not in this family'
    );
    expect(await db.select().from(schema.ledgerEntries)).toHaveLength(0);
  });

  it('skips an unknown cycle id without throwing', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Ivy', 2);
    const parent = seedParent(fam);

    const ids = [...(await getWeeklyReview(fam)).map((i) => i.cycleId), crypto.randomUUID()];
    // A stale page can post an id that no longer exists; that's a re-render.
    expect(await approvePayoutBatch(fam, parent, ids)).toBe(3);
  });

  it('writes no ledger entry for a zero-amount cycle', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Dee', 2);
    const parent = seedParent(fam);
    db.update(schema.families)
      .set({ payoutMode: 'fixed', payoutFixedCents: 0 })
      .where(eq(schema.families.id, fam))
      .run();

    const items = await getWeeklyReview(fam);
    expect(await approvePayoutBatch(fam, parent, items.map((i) => i.cycleId))).toBe(3);
    expect(await db.select().from(schema.ledgerEntries)).toHaveLength(0);
  });

  it('returns 0 for an empty id list', async () => {
    const fam = seedFamily();
    expect(await approvePayoutBatch(fam, seedParent(fam), [])).toBe(0);
  });
});

describe('skipPayoutBatch', () => {
  it('marks cycles skipped and creates no ledger entries', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Eli', 3);
    const parent = seedParent(fam);

    const items = await getWeeklyReview(fam);
    expect(await skipPayoutBatch(fam, parent, items.map((i) => i.cycleId))).toBe(4);
    expect(await db.select().from(schema.ledgerEntries)).toHaveLength(0);

    for (const c of await db.select().from(schema.payoutCycles)) {
      expect(c.status).toBe('skipped');
      expect(c.actualAmountCents).toBe(0);
    }
  });

  it('rejects a cycle belonging to another family', async () => {
    const famA = seedFamily('SA');
    const parentA = seedParent(famA);
    const famB = seedFamily('SB');
    seedKidJoined(famB, 'Fay', 2);
    const itemsB = await getWeeklyReview(famB);

    await expect(skipPayoutBatch(famA, parentA, [itemsB[0].cycleId])).rejects.toThrow(
      'Cycle not in this family'
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/server/payout-batch.test.ts`
Expected: FAIL — `approvePayoutBatch is not a function`.

- [ ] **Step 3: Implement the batch functions**

Add `inArray` to the drizzle import in `src/lib/server/payouts.ts`:

```ts
import { and, eq, gte, lte, inArray } from 'drizzle-orm';
```

Then append:

```ts
/**
 * Throws if any id belongs to a kid outside `familyId`. The batch actions take
 * ids straight from form data, so ownership can't be assumed the way it can for
 * the single-cycle actions, whose ids come from a trusted page load.
 *
 * Ids that don't exist at all are not an error — the caller's loop skips them.
 * A stale page is a re-render, not an attack.
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
            description: note?.trim() || `Weekly allowance (week of ${cycle.weekStarting})`,
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

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS, 20 files.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/payouts.ts src/lib/server/payout-batch.test.ts
git commit -m "feat(payouts): transactional batch approve/skip for queued weeks"
```

---

### Task 5: Review route and screen

The baseline renders a flat oldest-first list with an amber banner. Replace it with the three-section layout plus a collapsed, bulk-actionable group.

**Files:**
- Create: `src/lib/components/ReviewCard.svelte`
- Modify: `src/routes/review/+page.server.ts`
- Modify: `src/routes/review/+page.svelte` (full rewrite)

**Interfaces:**
- Consumes: `getReviewQueue` (Task 3), `approvePayoutBatch` / `skipPayoutBatch` (Task 4), `WeeklyReviewItem` from `$lib/review-types`.
- Produces: `load` returns `{ queue }` (was `{ items }`). Actions `approve`, `skip` (unchanged), plus `approveAll`, `skipAll` reading repeated `cycleId` fields via `data.getAll('cycleId')`.

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

  function shortDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  // A cycle stays actionable until finalized. 'reviewed' is currently unreachable,
  // but gating on 'open' alone would strand it if that ever changes.
  $: actionable = item.status !== 'paid' && item.status !== 'skipped';
  $: overdue = item.weeksAgo > 0;
</script>

<article
  class="rounded-xl border bg-white p-4 {overdue ? 'border-amber-300' : 'border-slate-200'}"
>
  <header class="flex items-center justify-between">
    <div>
      <div class="font-medium text-lg">{item.kidName}</div>
      <div class="text-xs text-slate-500">
        Age {item.age} · {shortDate(item.weekStarting)} – {shortDate(item.weekEnding)}
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
    <span class="text-slate-500"> chores {overdue ? 'that week' : 'this week'}</span>
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

- [ ] **Step 2: Update the route**

In `src/routes/review/+page.server.ts`, change the header comment, the import, and `load`:

```ts
// /review — parent-only. Weekly review: per-kid weekly summary + approve/skip.
// Every week the parent never finalized is still here, newest first, with older
// weeks collapsed into one bulk-actionable group — a forgotten week stays
// payable rather than vanishing.

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
```

Leave the existing `approve` and `skip` actions exactly as they are, and add two more to the same `actions` object:

```ts
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
```

- [ ] **Step 3: Rewrite the page**

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

  function shortDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  $: olderWeekCount = new Set(data.queue.older.map((i) => i.weekStarting)).size;
  $: olderTotalCents = data.queue.older.reduce((s, i) => s + i.suggestedAmountCents, 0);
  $: behindWeeks = new Set(
    [...data.queue.recent, ...data.queue.older].map((i) => i.weekStarting)
  ).size;
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

{#if behindWeeks > 0}
  <div class="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
    <div class="font-medium">
      {behindWeeks} earlier week{behindWeeks === 1 ? '' : 's'} still needs a decision.
    </div>
    <p class="mt-1 text-amber-800">
      Nothing was paid for {behindWeeks === 1 ? 'it' : 'them'} yet. Approving pays it now — it
      lands in the kid's history labelled with the week it covers — or skip to close it out.
    </p>
  </div>
{/if}

{#if nothingToDo}
  <p class="mt-6 text-slate-500">Nothing to review — you're all caught up.</p>
{/if}

{#if data.queue.current.length > 0}
  <section class="mt-6">
    <h2 class="text-xs font-medium uppercase tracking-wide text-slate-500">This week</h2>
    <div class="mt-2 space-y-4">
      {#each data.queue.current as item (item.cycleId)}
        <ReviewCard {item} />
      {/each}
    </div>
  </section>
{/if}

{#if data.queue.recent.length > 0}
  <section class="mt-8">
    <h2 class="text-xs font-medium uppercase tracking-wide text-amber-700">Waiting on you</h2>
    <div class="mt-2 space-y-4">
      {#each data.queue.recent as item (item.cycleId)}
        <ReviewCard {item} />
      {/each}
    </div>
  </section>
{/if}

{#if data.queue.older.length > 0}
  <section class="mt-8">
    <h2 class="text-xs font-medium uppercase tracking-wide text-slate-500">Earlier</h2>

    <div class="mt-2 rounded-xl border border-slate-200 bg-white p-4">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-medium">
            {olderWeekCount} earlier week{olderWeekCount === 1 ? '' : 's'} · {dollars(
              olderTotalCents
            )}
          </div>
          <div class="text-xs text-slate-500">
            Back to {shortDate(data.queue.older[data.queue.older.length - 1].weekStarting)}
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

- [ ] **Step 4: Typecheck and test**

Run: `npm run check`
Expected: no errors in `src/routes/review/` or `src/lib/components/`.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Verify in the browser**

Run: `npm run dev`

To produce a backlog in the dev DB, open `npm run db:studio` and set a kid's `persons.created_at` back six weeks, then delete that kid's `payout_cycles` rows. Reload `/review` and confirm: three sections appear; "Earlier" shows one row with a week count and dollar total; Expand reveals individual cards; Approve all clears the group and writes one ledger row per week.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/ReviewCard.svelte src/routes/review/+page.server.ts src/routes/review/+page.svelte
git commit -m "feat(review): three-section queue with collapsible bulk-action group"
```

---

### Task 6: Reminder fires once, on the family's payout day

The baseline nudges **daily** while any earlier week is unreviewed, and ignores `families.payoutDay`. Both are wrong per the spec: once, on the payout day, then silent.

There is also a gap worth fixing here: `countMissedWeeks` excludes the current week, so a reminder built on it only fires once you're *already* behind. The Sunday reminder exists to prevent that, so the nudge needs a count that includes the week in progress.

**Files:**
- Modify: `src/lib/server/payouts.ts` (add `countOutstandingWeeks`)
- Modify: `src/lib/server/review-reminder.ts`
- Modify: `src/lib/server/review-reminder.test.ts`

**Interfaces:**
- Produces:
  - `countOutstandingWeeks(familyId: string): Promise<number>` — distinct unfinalized weeks **including** the current one. Read-only, creates nothing, mirroring `countMissedWeeks`.
  - `remindMissedReviews(nowIso?: string): Promise<number>` — one new optional parameter so tests need no clock freezing.
- `countMissedWeeks` is unchanged and stays the dashboard badge's source (the badge means "you're behind", which correctly excludes the in-progress week).

- [ ] **Step 1: Add the read-only outstanding count**

In `src/lib/server/payouts.ts`, add beside `countMissedWeeks`:

```ts
/**
 * Distinct weeks still awaiting a decision, including the week in progress —
 * what the payout-day reminder counts. Read-only: like countMissedWeeks it
 * creates nothing, so a scheduled job never materializes cycles as a side effect.
 */
export async function countOutstandingWeeks(familyId: string): Promise<number> {
  const currentWeek = weekStarting(todayIso());
  const kids = await loadKids(familyId);

  const weeks = new Set<string>();
  for (const kid of kids) {
    const cycles = await cyclesByWeek(kid.id, earliestWeekFor(kid, currentWeek, true));
    for (const wk of outstandingWeeksFor(kid, currentWeek, cycles, true)) weeks.add(wk);
  }
  return weeks.size;
}
```

- [ ] **Step 2: Rewrite the reminder tests**

Replace `src/lib/server/review-reminder.test.ts` entirely:

```ts
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import { seedFamily, seedKid, seedCycle } from '$lib/server/test/seed';
import { missedWeeksPayload, remindMissedReviews } from '$lib/server/review-reminder';
import { todayIso, weekStarting, addWeeks, parseIsoDate, toIsoDate } from '$lib/server/dates';

const thisWeek = weekStarting(todayIso());
const lastWeek = addWeeks(thisWeek, -1);

function seedKidJoined(familyId: string, name: string, weeksAgo: number): string {
  const joined = addWeeks(thisWeek, -weeksAgo);
  return seedKid(familyId, name, '2016-01-01', new Date(`${joined}T12:00:00`).getTime());
}

/** An ISO date in the current week whose weekday is `dow` (0=Sun). */
function isoForWeekday(dow: number): string {
  const d = parseIsoDate(todayIso());
  d.setDate(d.getDate() - ((d.getDay() - dow + 7) % 7));
  return toIsoDate(d);
}

/** seedFamily defaults payoutDay to 0 (Sunday); this sets it explicitly. */
function setPayoutDay(familyId: string, day: number): void {
  db.update(schema.families)
    .set({ payoutDay: day })
    .where(eq(schema.families.id, familyId))
    .run();
}

describe('missedWeeksPayload', () => {
  it('reads as a single week', () => {
    const p = missedWeeksPayload(1);
    expect(p.title).toBe('1 week still needs review');
    expect(p.body).toContain('for it yet');
    expect(p.url).toBe('/review');
  });

  it('reads as several weeks', () => {
    expect(missedWeeksPayload(3).title).toBe('3 weeks still need review');
    expect(missedWeeksPayload(3).body).toContain('for them yet');
  });
});

describe('remindMissedReviews', () => {
  it('nudges on the payout day when a week is outstanding', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Ana', 0); // only the week in progress
    expect(await remindMissedReviews(isoForWeekday(0))).toBe(1);
  });

  it('stays silent on days that are not the payout day', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Bo', 1);
    setPayoutDay(fam, 0);
    // Wednesday.
    expect(await remindMissedReviews(isoForWeekday(3))).toBe(0);
  });

  it('honors a non-default payout day', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Cy', 1);
    setPayoutDay(fam, 5); // Friday
    expect(await remindMissedReviews(isoForWeekday(5))).toBe(1);
    expect(await remindMissedReviews(isoForWeekday(0))).toBe(0);
  });

  it('stays quiet when every week is finalized', async () => {
    const fam = seedFamily();
    const kid = seedKidJoined(fam, 'Dee', 1);
    seedCycle(kid, lastWeek, 'paid');
    seedCycle(kid, thisWeek, 'paid');
    expect(await remindMissedReviews(isoForWeekday(0))).toBe(0);
  });

  it('stays quiet for a family with no kids', async () => {
    seedFamily();
    expect(await remindMissedReviews(isoForWeekday(0))).toBe(0);
  });

  it('creates no cycles as a side effect', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Eli', 3);
    await remindMissedReviews(isoForWeekday(0));
    expect(await db.select().from(schema.payoutCycles)).toHaveLength(0);
  });

  it('nudges every family that is due, not just the first', async () => {
    const famA = seedFamily('One');
    seedKidJoined(famA, 'Fay', 1);
    const famB = seedFamily('Two');
    seedKidJoined(famB, 'Gus', 1);
    expect(await remindMissedReviews(isoForWeekday(0))).toBe(2);
  });
});
```

- [ ] **Step 3: Run to verify the new tests fail**

Run: `npx vitest run src/lib/server/review-reminder.test.ts`
Expected: FAIL — `remindMissedReviews` ignores its argument and the payout day, so the "not the payout day" and "non-default payout day" cases return the wrong count.

- [ ] **Step 4: Rework the reminder**

In `src/lib/server/review-reminder.ts`, replace the header comment and `remindMissedReviews`:

```ts
// Payout-day reminder for weeks awaiting a decision.
//
// The queue itself already recovers a forgotten week (payouts.ts) — this just
// keeps a backlog from forming. It fires once a week, on the family's chosen
// payoutDay, and then stays silent: missing it is now merely annoying rather
// than costly, and a nagging channel is a muted channel. Muting would take the
// chore-done alerts with it.
//
// Server off at 18:00 on payout day means no nudge that week. Acceptable — the
// queue is the safety net, not this.
//
// Mirrors backup.ts's globalThis-guarded scheduler so SvelteKit hot-reload
// doesn't create duplicate timers.

import { db, schema } from './db';
import { countOutstandingWeeks } from './payouts';
import { todayIso, dayOfWeek } from './dates';
import { sendToFamilyParents } from './push';
```

```ts
/**
 * Push every family whose payoutDay is `nowIso`'s weekday and which has a week
 * awaiting a decision. Returns families notified. `nowIso` is injectable so
 * tests don't have to freeze the clock.
 */
export async function remindMissedReviews(nowIso: string = todayIso()): Promise<number> {
  const dow = dayOfWeek(nowIso);
  const families = await db
    .select({ id: schema.families.id, payoutDay: schema.families.payoutDay })
    .from(schema.families);

  let notified = 0;
  for (const fam of families) {
    if (fam.payoutDay !== dow) continue;
    const count = await countOutstandingWeeks(fam.id);
    if (count === 0) continue;
    try {
      await sendToFamilyParents(fam.id, missedWeeksPayload(count));
      notified++;
    } catch (e) {
      // One family's dead endpoint must not stop the others.
      console.error('[review-reminder] push failed:', e);
    }
  }
  return notified;
}
```

Leave `missedWeeksPayload`, `REMINDER_HOUR`, `msUntilNext`, and `scheduleReviewReminder` unchanged — the timer still ticks daily; the payout-day check inside `remindMissedReviews` is what makes it weekly.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS, 20 files.

- [ ] **Step 6: Verify the scheduler still arms**

Run: `npm run dev`, load any page.
Expected: `[review-reminder] scheduler armed` in the server console.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/payouts.ts src/lib/server/review-reminder.ts src/lib/server/review-reminder.test.ts
git commit -m "feat(review): remind once on the family's payout day, not daily"
```

---

## Spec Coverage

| Spec requirement | Where |
|---|---|
| No schema change | Global constraint |
| Lazy backfill on read | Baseline `a036abb`, revised by Task 1 |
| No expiry window | Task 1 (removes `MAX_BACKFILL_WEEKS`) |
| Every week owed, regardless of chore activity | Task 1 (removes the activity gate) |
| Floor at the kid's join week | Task 1 — deviation from spec's `max(kid, family)` recorded in the task |
| Age as of each week's end | Baseline (`asOf = wkEnd < today ? wkEnd : today`) |
| Past amounts frozen; current week refreshed | Task 2 + two tests |
| Per-week chore counts | Baseline `instancesByWeek` + baseline test |
| `paid`/`skipped` excluded; `open`/`reviewed` included | Baseline `isFinalized` + baseline test; card gate in Task 5 |
| `current`/`recent`/`older`, all arrays | Task 3 |
| Bucketing by week, not by kid | Task 3 + test |
| `DETAIL_WEEKS = 2` constant | Task 3 |
| Batch approve at each cycle's own amount | Task 4 + test |
| Batch transactional; double-tap is a no-op | Task 4 + test |
| Batch returns actual count | Task 4 |
| Family-ownership check on batch ids | Task 4 + tests |
| Unknown batch id skipped, not an error | Task 4 + test |
| Route returns buckets; `approveAll`/`skipAll` via `getAll('cycleId')` | Task 5 |
| Collapsed older row with bulk buttons + expand | Task 5 |
| Card gate is `!== 'paid' && !== 'skipped'` | Task 5 `ReviewCard.svelte` |
| Nudge on `payoutDay`, only when outstanding | Task 6 + tests |
| Nudge failure never breaks the loop or re-arm | Task 6 try/catch + baseline `arm()` try/catch |
| Registered in `hooks.server.ts` | Baseline `a036abb` |
| Kid-facing UI unchanged | Global constraint |
| Missing birthdate → age 0 | Baseline (`kid.birthdate ? ... : 0`) |
| Leaderboard must not trigger backfill | Baseline `includePastWeeks = false` + baseline test; preserved by Tasks 1 and 6 |
