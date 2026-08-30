// The "N behind" badge and the list that clears it. The badge used to be a dead
// end: nothing in any screen could act on a past-due chore.

import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import { seedFamily, seedKid, seedChore, seedInstance } from '$lib/server/test/seed';
import {
  getCatchUpChores,
  getWeekProgress,
  markChoreDone,
  CATCH_UP_WINDOW_DAYS,
} from '$lib/server/chores';
import { confirmApproval, excuseChore, getPendingApprovals } from '$lib/server/family';
import { getCurrentWeekReview, getWeeklyReview } from '$lib/server/payouts';
import { todayIso, isoDaysAgo, weekStarting, addDays } from '$lib/server/dates';

function seedParent(familyId: string): string {
  const id = crypto.randomUUID();
  db.insert(schema.persons)
    .values({ id, familyId, name: 'Parent', role: 'parent', createdAt: Date.now() })
    .run();
  return id;
}

async function statusOf(instanceId: string): Promise<string> {
  const rows = await db
    .select({ status: schema.choreInstances.status })
    .from(schema.choreInstances)
    .where(eq(schema.choreInstances.id, instanceId));
  return rows[0].status;
}

describe('getCatchUpChores', () => {
  it('lists past-due chores the kid never marked, newest first', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Colin');
    const dishes = seedChore(fam, kid, 'Dishes');
    const trash = seedChore(fam, kid, 'Trash');
    seedInstance(dishes, isoDaysAgo(3), 'pending');
    seedInstance(trash, isoDaysAgo(1), 'pending');

    const items = await getCatchUpChores(kid);
    expect(items.map((i) => i.name)).toEqual(['Trash', 'Dishes']);
    expect(items.map((i) => i.daysLate)).toEqual([1, 3]);
  });

  it('includes a disputed chore — the kid can redo it, nobody else could act', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Colin');
    const chore = seedChore(fam, kid, 'Beds');
    seedInstance(chore, isoDaysAgo(2), 'disputed');
    expect((await getCatchUpChores(kid)).map((i) => i.status)).toEqual(['disputed']);
  });

  it("leaves out today's chores, which are not late yet", async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Colin');
    const chore = seedChore(fam, kid, 'Dishes');
    seedInstance(chore, todayIso(), 'pending');
    expect(await getCatchUpChores(kid)).toEqual([]);
  });

  it('leaves out done, confirmed and excused chores', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Colin');
    for (const [name, status] of [
      ['A', 'done'],
      ['B', 'confirmed'],
      ['C', 'excused'],
    ] as const) {
      seedInstance(seedChore(fam, kid, name), isoDaysAgo(2), status);
    }
    expect(await getCatchUpChores(kid)).toEqual([]);
  });

  it('drops anything older than the catch-up window', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Colin');
    const chore = seedChore(fam, kid, 'Dishes');
    seedInstance(chore, isoDaysAgo(CATCH_UP_WINDOW_DAYS + 1), 'pending');
    expect(await getCatchUpChores(kid)).toEqual([]);
  });

  it('counts a roll-forward chain once, not once per day it rolled', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Emily');
    const chore = seedChore(fam, kid, 'Laundry');
    // Missed Monday, rolled Tue → Wed → today. One obligation, four rows.
    const a = seedInstance(chore, isoDaysAgo(3), 'pending');
    const b = seedInstance(chore, isoDaysAgo(2), 'pending');
    const c = seedInstance(chore, isoDaysAgo(1), 'pending');
    const d = seedInstance(chore, todayIso(), 'pending');
    db.update(schema.choreInstances).set({ rolledFromId: a }).where(eq(schema.choreInstances.id, b)).run();
    db.update(schema.choreInstances).set({ rolledFromId: b }).where(eq(schema.choreInstances.id, c)).run();
    db.update(schema.choreInstances).set({ rolledFromId: c }).where(eq(schema.choreInstances.id, d)).run();

    // Only today's link is live, and it isn't late yet — it's on today's list.
    expect(await getCatchUpChores(kid)).toEqual([]);
  });

  it('still counts separate misses of a vanish chore separately', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Emily');
    const chore = seedChore(fam, kid, 'Dishes');
    seedInstance(chore, isoDaysAgo(3), 'pending');
    seedInstance(chore, isoDaysAgo(2), 'pending');
    expect(await getCatchUpChores(kid)).toHaveLength(2);
  });
});

describe('the behind badge matches the list', () => {
  it('reports exactly the number of chores the list can show', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Emily');
    seedInstance(seedChore(fam, kid, 'A'), isoDaysAgo(1), 'pending');
    seedInstance(seedChore(fam, kid, 'B'), isoDaysAgo(2), 'disputed');

    const progress = await getWeekProgress(kid);
    expect(progress.status).toBe('behind');
    expect(progress.behindCount).toBe((await getCatchUpChores(kid)).length);
    expect(progress.behindCount).toBe(2);
  });

  it('is on_track with nothing outstanding', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Colin');
    expect((await getWeekProgress(kid)).status).toBe('on_track');
  });
});

describe('clearing a behind chore', () => {
  it('kid marks a past-due chore done; it enters the parent approval queue', async () => {
    const fam = seedFamily();
    seedParent(fam);
    const kid = seedKid(fam, 'Colin');
    const chore = seedChore(fam, kid, 'Dishes');
    const inst = seedInstance(chore, isoDaysAgo(2), 'pending');

    await markChoreDone(kid, inst);

    expect(await getCatchUpChores(kid)).toEqual([]);
    expect((await getPendingApprovals(fam)).map((p) => p.instanceId)).toEqual([inst]);
  });

  it('kid can redo a disputed chore', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Colin');
    const inst = seedInstance(seedChore(fam, kid, 'Beds'), isoDaysAgo(2), 'disputed');
    await markChoreDone(kid, inst);
    expect(await statusOf(inst)).toBe('done');
  });

  it('parent credits a chore the kid never marked; it counts toward the week', async () => {
    const fam = seedFamily();
    const parent = seedParent(fam);
    const kid = seedKid(fam, 'Colin');
    const inst = seedInstance(seedChore(fam, kid, 'Dishes'), isoDaysAgo(1), 'pending');

    await confirmApproval(parent, inst);

    expect(await statusOf(inst)).toBe('confirmed');
    expect(await getCatchUpChores(kid)).toEqual([]);
    const week = (await getCurrentWeekReview(fam)).find((i) => i.kidId === kid)!;
    expect(week.confirmedCount).toBe(1);
    expect(week.totalCount).toBe(1);
  });

  it('parent excuses a chore; it counts neither for nor against the week', async () => {
    const fam = seedFamily();
    const parent = seedParent(fam);
    const kid = seedKid(fam, 'Emily');
    const excused = seedInstance(seedChore(fam, kid, 'Laundry'), isoDaysAgo(1), 'pending');
    seedInstance(seedChore(fam, kid, 'Dishes'), isoDaysAgo(1), 'confirmed');

    await excuseChore(parent, excused);

    expect(await statusOf(excused)).toBe('excused');
    expect(await getCatchUpChores(kid)).toEqual([]);
    // Out of the numerator AND the denominator: 1 of 1, not 1 of 2.
    const week = (await getCurrentWeekReview(fam)).find((i) => i.kidId === kid)!;
    expect(week.confirmedCount).toBe(1);
    expect(week.totalCount).toBe(1);
    expect(week.missedChoreNames).toEqual([]);
  });

  it('refuses to excuse a chore already confirmed', async () => {
    const fam = seedFamily();
    const parent = seedParent(fam);
    const kid = seedKid(fam, 'Colin');
    const inst = seedInstance(seedChore(fam, kid, 'Dishes'), isoDaysAgo(1), 'confirmed');
    await expect(excuseChore(parent, inst)).rejects.toThrow(/already confirmed/i);
    expect(await statusOf(inst)).toBe('confirmed');
  });

  it('will not let a parent touch another family’s chore', async () => {
    const famA = seedFamily('A');
    const famB = seedFamily('B');
    const parentB = seedParent(famB);
    const kidA = seedKid(famA, 'Colin');
    const inst = seedInstance(seedChore(famA, kidA, 'Dishes'), isoDaysAgo(1), 'pending');
    await expect(excuseChore(parentB, inst)).rejects.toThrow(/different family/i);
  });
});

describe('the week the chore belongs to', () => {
  it('settling a chore from last week credits last week, not this one', async () => {
    const fam = seedFamily();
    const parent = seedParent(fam);
    const kid = seedKid(fam, 'Colin', '2016-01-01', Date.now() - 120 * 86400000);
    const thisWeek = weekStarting(todayIso());
    const lastSunday = addDays(thisWeek, -1); // always the previous week's last day
    const inst = seedInstance(seedChore(fam, kid, 'Dishes'), lastSunday, 'pending');

    await confirmApproval(parent, inst);

    const items = await getWeeklyReview(fam);
    expect(items.find((i) => i.weekStarting === thisWeek)!.confirmedCount).toBe(0);
    expect(items.find((i) => i.weekStarting === weekStarting(lastSunday))!.confirmedCount).toBe(1);
  });
});
