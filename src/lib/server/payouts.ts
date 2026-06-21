// Payout cycle management.
//
// A PayoutCycle is one kid's review for one Mon–Sun week.
// suggested_amount_cents comes from the family's configurable payout scheme
// (resolvePayoutConfig + computeSuggestedCents in payout-config.ts); the default
// scheme reproduces the original "age in years × $1".
// Status flow: open → reviewed → paid (or skipped).

import { and, eq, gte, lte, inArray } from 'drizzle-orm';
import { db, schema } from './db';
import { todayIso, weekStarting, weekEnding, ageOn } from './dates';
import { resolvePayoutConfig, computeSuggestedCents } from './payout-config';

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

/**
 * Get-or-create the current week's payout cycle for each kid in the family,
 * and return the review summary for each.
 */
export async function getCurrentWeekReview(familyId: string): Promise<WeeklyReviewItem[]> {
  const today = todayIso();
  const wkStart = weekStarting(today);
  const wkEnd = weekEnding(today);

  const famRows = await db
    .select({
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
    })
    .from(schema.persons)
    .where(and(eq(schema.persons.familyId, familyId), eq(schema.persons.role, 'kid')));

  const items: WeeklyReviewItem[] = [];
  for (const kid of kids) {
    const age = kid.birthdate ? ageOn(kid.birthdate, today) : 0;
    const suggested = computeSuggestedCents(resolvePayoutConfig(family, kid.payoutOverride), age);

    // Get-or-create payout cycle
    let cycleRows = await db
      .select()
      .from(schema.payoutCycles)
      .where(
        and(
          eq(schema.payoutCycles.kidId, kid.id),
          eq(schema.payoutCycles.weekStarting, wkStart)
        )
      )
      .limit(1);
    let cycle = cycleRows[0];
    if (!cycle) {
      const id = crypto.randomUUID();
      db.insert(schema.payoutCycles)
        .values({
          id,
          kidId: kid.id,
          weekStarting: wkStart,
          status: 'open',
          suggestedAmountCents: suggested,
        })
        .run();
      cycle = (await db
        .select()
        .from(schema.payoutCycles)
        .where(eq(schema.payoutCycles.id, id))
        .limit(1))[0];
    } else if (cycle.suggestedAmountCents !== suggested && cycle.status === 'open') {
      // Birthday bumped age mid-week; refresh suggestion.
      db.update(schema.payoutCycles)
        .set({ suggestedAmountCents: suggested })
        .where(eq(schema.payoutCycles.id, cycle.id))
        .run();
      cycle.suggestedAmountCents = suggested;
    }

    // Count this week's instances by status.
    const instances = await db
      .select({
        id: schema.choreInstances.id,
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

    // "Missed" for display: pending + disputed (not yet kid-claimed-and-confirmed).
    const missedChoreNames = instances
      .filter((i) => i.status === 'pending' || i.status === 'disputed')
      .map((i) => i.choreName);

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
      confirmedCount: confirmedCount + doneCount, // count 'done' (kid did their part) toward responsibility
      pendingCount,
      disputedCount,
      totalCount: instances.length,
      missedChoreNames,
    });
  }

  return items;
}

/** Approve a payout: marks cycle as paid + creates a ledger credit. */
export async function approvePayout(
  parentPersonId: string,
  cycleId: string,
  amountCents: number,
  note?: string
): Promise<void> {
  if (amountCents < 0) throw new Error('Amount must be non-negative');

  const rows = await db
    .select()
    .from(schema.payoutCycles)
    .where(eq(schema.payoutCycles.id, cycleId))
    .limit(1);
  const cycle = rows[0];
  if (!cycle) throw new Error('Cycle not found');
  if (cycle.status === 'paid' || cycle.status === 'skipped') {
    throw new Error('Cycle already finalized');
  }

  const now = Date.now();
  // Mark cycle paid
  db.update(schema.payoutCycles)
    .set({
      status: 'paid',
      actualAmountCents: amountCents,
      reviewedAt: now,
      reviewedBy: parentPersonId,
      note: note ?? null,
    })
    .where(eq(schema.payoutCycles.id, cycleId))
    .run();

  // Ledger entry
  if (amountCents > 0) {
    db.insert(schema.ledgerEntries)
      .values({
        id: crypto.randomUUID(),
        kidId: cycle.kidId,
        kind: 'payout',
        amountCents,
        description: note?.trim() || `Weekly allowance (week of ${cycle.weekStarting})`,
        visibleToKid: true,
        createdAt: now,
        createdBy: parentPersonId,
        relatedPayoutCycleId: cycleId,
      })
      .run();
  }
}

/** Skip a week: marks cycle as skipped, no ledger entry. */
export async function skipPayout(
  parentPersonId: string,
  cycleId: string,
  note?: string
): Promise<void> {
  const rows = await db
    .select()
    .from(schema.payoutCycles)
    .where(eq(schema.payoutCycles.id, cycleId))
    .limit(1);
  const cycle = rows[0];
  if (!cycle) throw new Error('Cycle not found');
  if (cycle.status === 'paid' || cycle.status === 'skipped') {
    throw new Error('Cycle already finalized');
  }

  db.update(schema.payoutCycles)
    .set({
      status: 'skipped',
      actualAmountCents: 0,
      reviewedAt: Date.now(),
      reviewedBy: parentPersonId,
      note: note ?? null,
    })
    .where(eq(schema.payoutCycles.id, cycleId))
    .run();
}
