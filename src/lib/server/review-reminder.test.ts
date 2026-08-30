import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import { seedFamily, seedKid, seedCycle } from '$lib/server/test/seed';
import { missedWeeksPayload, remindMissedReviews } from '$lib/server/review-reminder';
import { countOutstandingWeeks } from '$lib/server/payouts';
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

// countOutstandingWeeks accumulates into one Set<string> shared across every
// kid in the family, but the "skip the current week" guard is evaluated
// per-kid (isFinalized(cycles.get(wk)?.status) looks only at that kid's own
// cycle). These pin the family-level result of that per-kid guard feeding a
// shared, family-level Set.
describe('countOutstandingWeeks (multi-kid current-week aggregation)', () => {
  it('counts the current week once when both kids have it open, not once per kid', async () => {
    const fam = seedFamily();
    seedKidJoined(fam, 'Hana', 0);
    seedKidJoined(fam, 'Ivo', 0);
    expect(await countOutstandingWeeks(fam)).toBe(1);
  });

  it('still counts the current week when one kid is finalized but the sibling is not', async () => {
    const fam = seedFamily();
    const a = seedKidJoined(fam, 'Jay', 0);
    seedKidJoined(fam, 'Kira', 0);
    seedCycle(a, thisWeek, 'paid');
    // Jay's own current-week cycle is finalized, but Kira's is still open —
    // the family still owes a decision for this week.
    expect(await countOutstandingWeeks(fam)).toBe(1);
  });

  it('is zero once both kids’ current weeks are finalized with no earlier weeks owed', async () => {
    const fam = seedFamily();
    const a = seedKidJoined(fam, 'Leo', 0);
    const b = seedKidJoined(fam, 'Mimi', 0);
    seedCycle(a, thisWeek, 'paid');
    seedCycle(b, thisWeek, 'skipped');
    expect(await countOutstandingWeeks(fam)).toBe(0);
  });
});
