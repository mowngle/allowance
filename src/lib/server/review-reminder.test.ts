import { describe, it, expect } from 'vitest';
import { seedFamily, seedKid, seedCycle } from '$lib/server/test/seed';
import { missedWeeksPayload, remindMissedReviews } from '$lib/server/review-reminder';
import { todayIso, weekStarting, addWeeks } from '$lib/server/dates';

const thisWeek = weekStarting(todayIso());
const lastWeek = addWeeks(thisWeek, -1);
const MONTHS_AGO = Date.now() - 120 * 24 * 60 * 60 * 1000;

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
  it('nudges only families with an unreviewed earlier week', async () => {
    const behind = seedFamily('Behind');
    const kid = seedKid(behind, 'Ana', '2016-01-01', MONTHS_AGO);
    seedCycle(kid, lastWeek, 'open');

    const uptodate = seedFamily('Up to date');
    seedKid(uptodate, 'Bo', '2016-01-01', MONTHS_AGO);

    expect(await remindMissedReviews()).toBe(1);
  });

  it('stays quiet when nothing is overdue', async () => {
    const fam = seedFamily();
    seedKid(fam, 'Cy', '2016-01-01', MONTHS_AGO);
    expect(await remindMissedReviews()).toBe(0);
  });
});
