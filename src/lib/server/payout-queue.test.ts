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
