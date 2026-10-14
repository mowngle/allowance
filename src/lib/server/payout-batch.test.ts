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

  it('acts only on the unfinalized cycles in a mixed batch', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Jax', 3);
    const parent = seedParent(fam);

    const ids = (await getWeeklyReview(fam)).map((i) => i.cycleId);
    // Finalize half the batch up front, then resubmit the full set.
    expect(await approvePayoutBatch(fam, parent, ids.slice(0, 2))).toBe(2);
    expect(await approvePayoutBatch(fam, parent, ids)).toBe(2);

    const cycles = await db.select().from(schema.payoutCycles);
    expect(cycles.every((c) => c.status === 'paid')).toBe(true);
    expect(await db.select().from(schema.ledgerEntries)).toHaveLength(4);
  });

  it('links each ledger entry back to its own payout cycle and marks it visible to the kid', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Gia', 2);
    const parent = seedParent(fam);

    const items = await getWeeklyReview(fam);
    const cycleIds = items.map((i) => i.cycleId);
    expect(await approvePayoutBatch(fam, parent, cycleIds)).toBe(3);

    const entries = await db.select().from(schema.ledgerEntries);
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map((e) => e.relatedPayoutCycleId))).toEqual(new Set(cycleIds));
    for (const e of entries) {
      expect(e.visibleToKid).toBe(true);
    }
  });

  it('uses a non-blank note as the ledger description and stores the raw note on the cycle', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Hana', 1);
    const parent = seedParent(fam);

    const items = await getWeeklyReview(fam);
    expect(
      await approvePayoutBatch(fam, parent, items.map((i) => i.cycleId), '  Birthday bonus  ')
    ).toBe(2);

    const entries = await db.select().from(schema.ledgerEntries);
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      // Description uses the trimmed note...
      expect(e.description).toBe('Birthday bonus');
    }
    for (const c of await db.select().from(schema.payoutCycles)) {
      // ...but the cycle keeps the note exactly as given.
      expect(c.note).toBe('  Birthday bonus  ');
    }
  });

  it('falls back to the default description when note is blank', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Ivo', 1);
    const parent = seedParent(fam);

    const items = await getWeeklyReview(fam);
    expect(await approvePayoutBatch(fam, parent, items.map((i) => i.cycleId), '   ')).toBe(2);

    const entries = await db.select().from(schema.ledgerEntries);
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.description).toMatch(/^Weekly allowance \(week of \d{4}-\d{2}-\d{2}\)$/);
    }
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

  it('stores the note on each skipped cycle', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Kira', 1);
    const parent = seedParent(fam);

    const items = await getWeeklyReview(fam);
    expect(
      await skipPayoutBatch(fam, parent, items.map((i) => i.cycleId), 'Family vacation')
    ).toBe(2);

    for (const c of await db.select().from(schema.payoutCycles)) {
      expect(c.note).toBe('Family vacation');
    }
    expect(await db.select().from(schema.ledgerEntries)).toHaveLength(0);
  });

  it('acts only on the unfinalized cycles in a mixed batch', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Lyle', 3);
    const parent = seedParent(fam);

    const ids = (await getWeeklyReview(fam)).map((i) => i.cycleId);
    expect(await skipPayoutBatch(fam, parent, ids.slice(0, 2))).toBe(2);
    expect(await skipPayoutBatch(fam, parent, ids)).toBe(2);

    const cycles = await db.select().from(schema.payoutCycles);
    expect(cycles.every((c) => c.status === 'skipped')).toBe(true);
  });
});
