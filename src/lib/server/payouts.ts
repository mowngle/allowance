// Payout cycle management.
//
// A PayoutCycle is one kid's review for one Mon–Sun week.
// suggested_amount_cents comes from the family's configurable payout scheme
// (resolvePayoutConfig + computeSuggestedCents in payout-config.ts); the default
// scheme reproduces the original "age in years × $1".
// Status flow: open → reviewed → paid (or skipped).
//
// Weeks are never silently dropped. A parent who forgets to review a week finds
// that week still waiting the next time they open /review: getWeeklyReview walks
// back to the week each kid was added, materializes a cycle for every week that
// was never finalized, and returns those alongside the current week. There is no
// cap and no "did anything happen that week" filter — either would re-create the
// expiry this exists to remove. Backdated weeks are valued as of the week they
// cover (the kid's age then, not today's), so a birthday in between doesn't
// inflate an old week.

import { and, eq, gte, lte, inArray } from 'drizzle-orm';
import { db, schema } from './db';
import type { PayoutCycle } from './schema';
import {
  todayIso,
  toIsoDate,
  weekStarting,
  weekEnding,
  weeksFromThrough,
  ageOn,
} from './dates';
import { resolvePayoutConfig, computeSuggestedCents } from './payout-config';
import type { WeeklyReviewItem, ReviewQueue } from '$lib/review-types';
export type { WeeklyReviewItem, ReviewQueue };

type FamilyPayoutRow = {
  payoutMode: 'age' | 'fixed';
  payoutCentsPerYear: number;
  payoutBonusCents: number;
  payoutFixedCents: number;
};

type KidRow = {
  id: string;
  name: string;
  birthdate: string | null;
  payoutOverride: string | null;
  createdAt: number;
};

type InstanceRow = { status: string; choreName: string; dueDate: string };

async function loadFamily(familyId: string): Promise<FamilyPayoutRow | undefined> {
  const rows = await db
    .select({
      payoutMode: schema.families.payoutMode,
      payoutCentsPerYear: schema.families.payoutCentsPerYear,
      payoutBonusCents: schema.families.payoutBonusCents,
      payoutFixedCents: schema.families.payoutFixedCents,
    })
    .from(schema.families)
    .where(eq(schema.families.id, familyId))
    .limit(1);
  return rows[0];
}

async function loadKids(familyId: string): Promise<KidRow[]> {
  return db
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
}

/** The oldest week we look back to for this kid: the week they were added.
 *  No window cap — a week is owed whether or not anyone opened the app that
 *  month, so capping it would re-introduce the expiry this feature removes. */
function earliestWeekFor(kid: KidRow, currentWeek: string, includePast: boolean): string {
  if (!includePast) return currentWeek;
  return weekStarting(toIsoDate(new Date(kid.createdAt)));
}

function isFinalized(status: string | undefined): boolean {
  return status === 'paid' || status === 'skipped';
}

/** Chore instances for a kid over a date range, bucketed by their week anchor. */
async function instancesByWeek(
  kidId: string,
  fromDate: string,
  toDate: string
): Promise<Map<string, InstanceRow[]>> {
  const rows = await db
    .select({
      status: schema.choreInstances.status,
      choreName: schema.chores.name,
      dueDate: schema.choreInstances.dueDate,
    })
    .from(schema.choreInstances)
    .innerJoin(schema.chores, eq(schema.chores.id, schema.choreInstances.choreId))
    .where(
      and(
        eq(schema.chores.assigneeId, kidId),
        gte(schema.choreInstances.dueDate, fromDate),
        lte(schema.choreInstances.dueDate, toDate)
      )
    );

  const byWeek = new Map<string, InstanceRow[]>();
  for (const row of rows) {
    const wk = weekStarting(row.dueDate);
    const bucket = byWeek.get(wk);
    if (bucket) bucket.push(row);
    else byWeek.set(wk, [row]);
  }
  return byWeek;
}

/** Existing payout cycles for a kid from `fromWeek` onward, keyed by week anchor. */
async function cyclesByWeek(
  kidId: string,
  fromWeek: string
): Promise<Map<string, PayoutCycle>> {
  const rows = await db
    .select()
    .from(schema.payoutCycles)
    .where(
      and(eq(schema.payoutCycles.kidId, kidId), gte(schema.payoutCycles.weekStarting, fromWeek))
    );
  return new Map(rows.map((c) => [c.weekStarting, c]));
}

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
    // Two overlapping requests can both see no existing cycle and both insert
    // for the same (kidId, weekStarting) — onConflictDoNothing lets the loser's
    // insert become a no-op instead of throwing the UNIQUE constraint. Because
    // the loser's generated id was never written on conflict, the row is
    // re-selected by (kidId, weekStarting) rather than by that id.
    db.insert(schema.payoutCycles)
      .values({
        id: crypto.randomUUID(),
        kidId: kid.id,
        weekStarting: weekStart,
        status: 'open',
        suggestedAmountCents: suggested,
      })
      .onConflictDoNothing()
      .run();
    return (
      await db
        .select()
        .from(schema.payoutCycles)
        .where(
          and(
            eq(schema.payoutCycles.kidId, kid.id),
            eq(schema.payoutCycles.weekStarting, weekStart)
          )
        )
        .limit(1)
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

function buildItem(
  kid: KidRow,
  cycle: PayoutCycle,
  weekStart: string,
  age: number,
  weeksAgo: number,
  instances: InstanceRow[]
): WeeklyReviewItem {
  const confirmedCount = instances.filter((i) => i.status === 'confirmed').length;
  const pendingCount = instances.filter((i) => i.status === 'pending').length;
  const disputedCount = instances.filter((i) => i.status === 'disputed').length;
  const doneCount = instances.filter((i) => i.status === 'done').length;

  return {
    cycleId: cycle.id,
    kidId: kid.id,
    kidName: kid.name,
    age,
    weekStarting: weekStart,
    weekEnding: weekEnding(weekStart),
    weeksAgo,
    suggestedAmountCents: cycle.suggestedAmountCents,
    status: cycle.status,
    actualAmountCents: cycle.actualAmountCents,
    // count 'done' (kid did their part) toward responsibility
    confirmedCount: confirmedCount + doneCount,
    pendingCount,
    disputedCount,
    totalCount: instances.length,
    // "Missed" for display: pending + disputed (not yet kid-claimed-and-confirmed).
    missedChoreNames: instances
      .filter((i) => i.status === 'pending' || i.status === 'disputed')
      .map((i) => i.choreName),
  };
}

/**
 * The parent's review queue: every week still awaiting a decision for every
 * active kid, oldest week first, ending with the week in progress. Cycles are
 * created on demand, so a week nobody opened the app during is recoverable.
 *
 * `includePastWeeks: false` restricts it to the week in progress and skips the
 * backfill entirely — for read paths (the leaderboard summary) that only want
 * this week and shouldn't be materializing old cycles as a side effect.
 */
export async function getWeeklyReview(
  familyId: string,
  includePastWeeks = true
): Promise<WeeklyReviewItem[]> {
  const today = todayIso();
  const currentWeek = weekStarting(today);
  const currentWeekEnd = weekEnding(today);

  const family = await loadFamily(familyId);
  if (!family) return [];
  const kids = await loadKids(familyId);

  const items: WeeklyReviewItem[] = [];
  for (const kid of kids) {
    const from = earliestWeekFor(kid, currentWeek, includePastWeeks);
    const [instances, cycles] = await Promise.all([
      instancesByWeek(kid.id, from, currentWeekEnd),
      cyclesByWeek(kid.id, from),
    ]);

    for (const weekStart of outstandingWeeksFor(kid, currentWeek, cycles, includePastWeeks)) {
      const wkEnd = weekEnding(weekStart);
      // Value a past week as of the week it covers, not as of today.
      const asOf = wkEnd < today ? wkEnd : today;
      const age = kid.birthdate ? ageOn(kid.birthdate, asOf) : 0;
      const suggested = computeSuggestedCents(
        resolvePayoutConfig(family, kid.payoutOverride),
        age
      );
      const cycle = await ensureCycle(
        kid,
        weekStart,
        suggested,
        cycles.get(weekStart),
        weekStart === currentWeek
      );
      const weeksAgo = weeksFromThrough(weekStart, currentWeek).length - 1;
      items.push(
        buildItem(kid, cycle, weekStart, age, weeksAgo, instances.get(weekStart) ?? [])
      );
    }
  }

  // Oldest week first so the forgotten weeks are dealt with before this one;
  // kids stay grouped in roster order within a week.
  return items.sort((a, b) => b.weeksAgo - a.weeksAgo);
}

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

/**
 * Get-or-create the current week's payout cycle for each kid in the family,
 * and return the review summary for each. Earlier unreviewed weeks are ignored
 * here — use getWeeklyReview for the parent's actual queue.
 */
export async function getCurrentWeekReview(familyId: string): Promise<WeeklyReviewItem[]> {
  return getWeeklyReview(familyId, false);
}

/**
 * How many *earlier* weeks still need a decision somewhere in this family —
 * the nudge count for the dashboard and the reminder push. Read-only: unlike
 * getWeeklyReview it creates nothing.
 */
export async function countMissedWeeks(familyId: string): Promise<number> {
  const today = todayIso();
  const currentWeek = weekStarting(today);
  const kids = await loadKids(familyId);

  const weeks = new Set<string>();
  for (const kid of kids) {
    const from = earliestWeekFor(kid, currentWeek, true);
    const cycles = await cyclesByWeek(kid.id, from);
    for (const wk of outstandingWeeksFor(kid, currentWeek, cycles, true)) {
      if (wk !== currentWeek) weeks.add(wk);
    }
  }
  return weeks.size;
}

/**
 * Distinct weeks still awaiting a decision, including the week in progress —
 * what the payout-day reminder counts. Read-only: like countMissedWeeks it
 * creates nothing, so a scheduled job never materializes cycles as a side effect.
 *
 * outstandingWeeksFor always includes the current week unconditionally (so the
 * review screen keeps showing it even once paid), but a *finalized* current
 * week is not something a reminder should nag about, so it's excluded here the
 * same way countMissedWeeks excludes it entirely.
 */
export async function countOutstandingWeeks(familyId: string): Promise<number> {
  const currentWeek = weekStarting(todayIso());
  const kids = await loadKids(familyId);

  const weeks = new Set<string>();
  for (const kid of kids) {
    const cycles = await cyclesByWeek(kid.id, earliestWeekFor(kid, currentWeek, true));
    for (const wk of outstandingWeeksFor(kid, currentWeek, cycles, true)) {
      if (wk === currentWeek && isFinalized(cycles.get(wk)?.status)) continue;
      weeks.add(wk);
    }
  }
  return weeks.size;
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

  // Ledger entry. The description names the week, not "this week", so a
  // late-approved week reads correctly in the kid's history.
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
