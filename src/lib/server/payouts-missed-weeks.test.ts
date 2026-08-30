// The forgotten-week path: a parent who never opened /review for a week should
// still find that week waiting, payable, and valued as of the week it covers.

import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import { seedFamily, seedKid, seedChore, seedInstance, seedCycle } from '$lib/server/test/seed';
import {
  getWeeklyReview,
  getCurrentWeekReview,
  countMissedWeeks,
  approvePayout,
  skipPayout,
} from '$lib/server/payouts';
import { todayIso, weekStarting, weekEnding, addWeeks, addDays } from '$lib/server/dates';

const today = todayIso();
const thisWeek = weekStarting(today);
const lastWeek = addWeeks(thisWeek, -1);
const twoWeeksAgo = addWeeks(thisWeek, -2);

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

describe('unreviewed earlier weeks', () => {
  it('surfaces a past week whose cycle was left open, oldest first', async () => {
    const fam = seedFamily();
    const kid = seedKidJoined(fam, 'Ana', 2);
    seedCycle(kid, lastWeek, 'open');
    seedCycle(kid, twoWeeksAgo, 'open');

    const items = await getWeeklyReview(fam);
    expect(items.map((i) => i.weekStarting)).toEqual([twoWeeksAgo, lastWeek, thisWeek]);
    expect(items.map((i) => i.weeksAgo)).toEqual([2, 1, 0]);
  });

  it('backfills a week that has chore activity but no cycle at all', async () => {
    const fam = seedFamily();
    const kid = seedKidJoined(fam, 'Bo', 2);
    const chore = seedChore(fam, kid, 'Dishes');
    seedInstance(chore, addDays(lastWeek, 2), 'confirmed');

    const items = await getWeeklyReview(fam);
    const past = items.find((i) => i.weekStarting === lastWeek)!;
    expect(past).toBeDefined();
    expect(past.status).toBe('open');
    expect(past.confirmedCount).toBe(1);
    expect(past.totalCount).toBe(1);

    // The cycle is now persisted, so the week can be approved.
    const rows = await db
      .select()
      .from(schema.payoutCycles)
      .where(eq(schema.payoutCycles.id, past.cycleId));
    expect(rows).toHaveLength(1);
    expect(rows[0].weekStarting).toBe(lastWeek);
  });

  it('surfaces a past week even when nothing was tracked in it', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Cy', 2);
    const items = await getWeeklyReview(fam);
    expect(items.map((i) => i.weekStarting)).toEqual([twoWeeksAgo, lastWeek, thisWeek]);
  });

  it('drops a past week once it is paid or skipped', async () => {
    const fam = seedFamily();
    const kid = seedKidJoined(fam, 'Dee', 2);
    seedCycle(kid, lastWeek, 'paid');
    seedCycle(kid, twoWeeksAgo, 'skipped');
    const items = await getWeeklyReview(fam);
    expect(items.map((i) => i.weekStarting)).toEqual([thisWeek]);
  });

  it('keeps a past week that was reviewed but never finalized', async () => {
    const fam = seedFamily();
    const kid = seedKidJoined(fam, 'Eli', 1);
    seedCycle(kid, lastWeek, 'reviewed');
    const items = await getWeeklyReview(fam);
    expect(items.map((i) => i.weekStarting)).toEqual([lastWeek, thisWeek]);
  });

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

  it('never looks back past the week the kid was added', async () => {
    const fam = seedFamily();
    const joined = addWeeks(thisWeek, -3);
    const kid = seedKid(fam, 'Gus', '2016-01-01', new Date(`${joined}T12:00:00`).getTime());
    seedCycle(kid, addWeeks(thisWeek, -5), 'open'); // before they existed
    seedCycle(kid, addWeeks(thisWeek, -2), 'open');

    const items = await getWeeklyReview(fam);
    expect(items.map((i) => i.weekStarting)).toEqual([
      addWeeks(thisWeek, -3),
      addWeeks(thisWeek, -2),
      lastWeek,
      thisWeek,
    ]);
  });

  it('counts each kid-week separately but reports one row per kid per week', async () => {
    const fam = seedFamily();
    const a = seedKidJoined(fam, 'Hana', 1);
    const b = seedKidJoined(fam, 'Ivo', 1);
    seedCycle(a, lastWeek, 'open');
    seedCycle(b, lastWeek, 'open');

    const items = await getWeeklyReview(fam);
    expect(items.filter((i) => i.weekStarting === lastWeek).map((i) => i.kidName).sort()).toEqual([
      'Hana',
      'Ivo',
    ]);
  });
});

describe('concurrent single-cycle finalization', () => {
  it('two concurrent approvePayout calls on one cycle produce exactly one ledger entry', async () => {
    const fam = seedFamily();
    const parent = crypto.randomUUID();
    db.insert(schema.persons)
      .values({ id: parent, familyId: fam, name: 'P', role: 'parent', createdAt: Date.now() })
      .run();
    const kid = seedKidJoined(fam, 'Vik', 0);
    const cycleId = seedCycle(kid, thisWeek, 'open', 800);

    const results = await Promise.allSettled([
      approvePayout(parent, cycleId, 800),
      approvePayout(parent, cycleId, 800),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason.message).toBe('Cycle already finalized');

    const entries = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.kidId, kid));
    expect(entries).toHaveLength(1);
    expect(entries[0].amountCents).toBe(800);
  });

  it('two concurrent skipPayout calls on one cycle skip it exactly once', async () => {
    const fam = seedFamily();
    const parent = crypto.randomUUID();
    db.insert(schema.persons)
      .values({ id: parent, familyId: fam, name: 'P', role: 'parent', createdAt: Date.now() })
      .run();
    const kid = seedKidJoined(fam, 'Wren', 0);
    const cycleId = seedCycle(kid, thisWeek, 'open', 800);

    const results = await Promise.allSettled([
      skipPayout(parent, cycleId),
      skipPayout(parent, cycleId),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason.message).toBe('Cycle already finalized');

    const cycle = (
      await db.select().from(schema.payoutCycles).where(eq(schema.payoutCycles.id, cycleId))
    )[0];
    expect(cycle.status).toBe('skipped');
    expect(await db.select().from(schema.ledgerEntries)).toHaveLength(0);
  });
});

describe('concurrent review loads', () => {
  it('two overlapping getWeeklyReview calls both resolve with no duplicate cycles', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Uma', 5);

    const results = await Promise.allSettled([getWeeklyReview(fam), getWeeklyReview(fam)]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const cycles = await db.select().from(schema.payoutCycles);
    const seen = new Set<string>();
    for (const c of cycles) {
      const key = `${c.kidId}:${c.weekStarting}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    // Six weeks (5 back-filled + this week) materialized exactly once each.
    expect(cycles).toHaveLength(6);
  });
});

describe('backdated valuation', () => {
  it('values a past week at the age the kid was that week, not today', async () => {
    const fam = seedFamily();
    // Birthday lands on this week's Monday, so last week they were a year younger.
    const [y, m, d] = thisWeek.split('-');
    const birthdate = `${Number(y) - 16}-${m}-${d}`;
    const kid = seedKidJoined(fam, 'Jae', 1, birthdate);

    const items = await getWeeklyReview(fam);
    const past = items.find((i) => i.weekStarting === lastWeek)!;
    const current = items.find((i) => i.weekStarting === thisWeek)!;
    expect(past.age).toBe(15);
    expect(past.suggestedAmountCents).toBe(1500);
    expect(current.age).toBe(16);
    expect(current.suggestedAmountCents).toBe(1600);
  });

  it('leaves a past week’s stored suggestion alone', async () => {
    const fam = seedFamily();
    // Birthday lands on this week's Monday, so last week they were a year younger.
    const [y, m, d] = thisWeek.split('-');
    const birthdate = `${Number(y) - 14}-${m}-${d}`;
    const kid = seedKidJoined(fam, 'Kit', 1, birthdate);
    seedCycle(kid, lastWeek, 'open', 777); // whatever it was worth then

    const items = await getWeeklyReview(fam);
    const past = items.find((i) => i.weekStarting === lastWeek)!;
    // A past week is history: its amount is frozen once written, so changing
    // the family's payout scheme can't retroactively revalue it.
    expect(past.suggestedAmountCents).toBe(777);
    // The age, unlike the amount, is always recomputed for the week it describes.
    expect(past.age).toBe(13);

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

  it('counts only that week’s chores against a past week', async () => {
    const fam = seedFamily();
    const kid = seedKidJoined(fam, 'Lia', 1);
    const chore = seedChore(fam, kid, 'Trash');
    seedInstance(chore, addDays(lastWeek, 1), 'confirmed');
    seedInstance(chore, addDays(lastWeek, 2), 'pending');
    seedInstance(chore, thisWeek, 'confirmed');

    const items = await getWeeklyReview(fam);
    const past = items.find((i) => i.weekStarting === lastWeek)!;
    expect(past.totalCount).toBe(2);
    expect(past.confirmedCount).toBe(1);
    expect(past.missedChoreNames).toEqual(['Trash']);
    expect(past.weekEnding).toBe(weekEnding(lastWeek));

    const current = items.find((i) => i.weekStarting === thisWeek)!;
    expect(current.totalCount).toBe(1);
  });
});

describe('finalizing a forgotten week', () => {
  it('approving it pays the kid and labels the ledger with that week', async () => {
    const fam = seedFamily();
    const parent = crypto.randomUUID();
    db.insert(schema.persons)
      .values({ id: parent, familyId: fam, name: 'P', role: 'parent', createdAt: Date.now() })
      .run();
    const kid = seedKidJoined(fam, 'Mo', 1);
    seedCycle(kid, lastWeek, 'open');

    const past = (await getWeeklyReview(fam)).find((i) => i.weekStarting === lastWeek)!;
    await approvePayout(parent, past.cycleId, past.suggestedAmountCents);

    const entries = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.kidId, kid));
    expect(entries).toHaveLength(1);
    expect(entries[0].description).toBe(`Weekly allowance (week of ${lastWeek})`);
    expect(entries[0].amountCents).toBe(past.suggestedAmountCents);

    // And it stops asking.
    const after = await getWeeklyReview(fam);
    expect(after.map((i) => i.weekStarting)).toEqual([thisWeek]);
  });

  it('skipping it closes the week without a ledger entry', async () => {
    const fam = seedFamily();
    const parent = crypto.randomUUID();
    db.insert(schema.persons)
      .values({ id: parent, familyId: fam, name: 'P', role: 'parent', createdAt: Date.now() })
      .run();
    const kid = seedKidJoined(fam, 'Nia', 1);
    seedCycle(kid, lastWeek, 'open');

    const past = (await getWeeklyReview(fam)).find((i) => i.weekStarting === lastWeek)!;
    await skipPayout(parent, past.cycleId, 'we were away');

    const entries = await db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.kidId, kid));
    expect(entries).toHaveLength(0);
    expect((await getWeeklyReview(fam)).map((i) => i.weekStarting)).toEqual([thisWeek]);
  });
});

describe('countMissedWeeks', () => {
  it('counts distinct earlier weeks and ignores the week in progress', async () => {
    const fam = seedFamily();
    const a = seedKidJoined(fam, 'Oz', 2);
    const b = seedKidJoined(fam, 'Pia', 2);
    seedCycle(a, lastWeek, 'open');
    seedCycle(b, lastWeek, 'open'); // same week, both kids → still one week
    seedCycle(a, twoWeeksAgo, 'open');

    expect(await countMissedWeeks(fam)).toBe(2);
  });

  it('is zero when only the current week is open', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Quin', 0);
    expect(await countMissedWeeks(fam)).toBe(0);
  });

  it('creates nothing — it only reports', async () => {
    const fam = seedFamily();
    const kid = seedKidJoined(fam, 'Rae', 1);
    const chore = seedChore(fam, kid, 'Beds');
    seedInstance(chore, addDays(lastWeek, 3), 'pending');

    expect(await countMissedWeeks(fam)).toBe(1);
    const cycles = await db.select().from(schema.payoutCycles);
    expect(cycles).toHaveLength(0);
  });
});

describe('getCurrentWeekReview', () => {
  it('still returns only the week in progress', async () => {
    const fam = seedFamily();
    const kid = seedKidJoined(fam, 'Sol', 1);
    seedCycle(kid, lastWeek, 'open');
    const items = await getCurrentWeekReview(fam);
    expect(items.map((i) => i.weekStarting)).toEqual([thisWeek]);
  });

  it('does not backfill old cycles as a side effect', async () => {
    const fam = seedFamily();
    const kid = seedKidJoined(fam, 'Tam', 1);
    const chore = seedChore(fam, kid, 'Sweep');
    seedInstance(chore, addDays(lastWeek, 2), 'confirmed');

    await getCurrentWeekReview(fam);
    const weeks = (await db.select().from(schema.payoutCycles)).map((c) => c.weekStarting);
    expect(weeks).toEqual([thisWeek]);
  });
});
