import { describe, it, expect } from 'vitest';
import { todayIso, isoDaysAgo } from './dates';
import { streakForKid, badgesForKid, buildLocalSummary } from './leaderboard';
import { seedFamily, seedKid, seedChore, seedInstance } from './test/seed';

describe('streakForKid', () => {
  it('counts consecutive past days with all chores done', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    const chore = seedChore(fam, kid);
    seedInstance(chore, isoDaysAgo(1), 'confirmed');
    seedInstance(chore, isoDaysAgo(2), 'done');
    seedInstance(chore, isoDaysAgo(3), 'confirmed');
    expect(await streakForKid(kid)).toBe(3);
  });

  it('breaks the streak on a past missed day', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    const chore = seedChore(fam, kid);
    seedInstance(chore, isoDaysAgo(1), 'confirmed');
    seedInstance(chore, isoDaysAgo(2), 'pending');
    seedInstance(chore, isoDaysAgo(3), 'confirmed');
    expect(await streakForKid(kid)).toBe(1);
  });

  it('treats a no-chore day as neutral (does not break)', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    const chore = seedChore(fam, kid);
    seedInstance(chore, isoDaysAgo(1), 'confirmed');
    seedInstance(chore, isoDaysAgo(3), 'confirmed');
    expect(await streakForKid(kid)).toBe(2);
  });

  it("today's still-pending chore does not break the streak", async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    const chore = seedChore(fam, kid);
    seedInstance(chore, todayIso(), 'pending');
    seedInstance(chore, isoDaysAgo(1), 'confirmed');
    expect(await streakForKid(kid)).toBe(1);
  });
});

describe('badgesForKid', () => {
  it('awards perfect-week at 100% and iron-streak at >=14', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    const chore = seedChore(fam, kid);
    for (let d = 1; d <= 16; d++) seedInstance(chore, isoDaysAgo(d), 'confirmed');
    const badges = await badgesForKid(kid, 100);
    expect(badges).toContain('perfect-week');
    expect(badges).toContain('iron-streak');
  });

  it('awards dawn-patrol when each of the last 5 days had a pre-8am completion', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    const chore = seedChore(fam, kid);
    for (let d = 0; d < 5; d++) {
      const day = isoDaysAgo(d);
      const at = new Date(`${day}T06:30:00`).getTime();
      seedInstance(chore, day, 'confirmed', at);
    }
    expect(await badgesForKid(kid, 50)).toContain('dawn-patrol');
  });

  it('no badges for a middling week', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    expect(await badgesForKid(kid, 60)).toEqual([]);
  });
});

describe('buildLocalSummary', () => {
  it('produces house name, weekStarting, and a kid with pct + streak', async () => {
    const fam = seedFamily('Smith');
    const kid = seedKid(fam, 'Mia');
    const chore = seedChore(fam, kid);
    seedInstance(chore, isoDaysAgo(1), 'confirmed');
    seedInstance(chore, isoDaysAgo(2), 'pending');
    const summary = await buildLocalSummary(fam);
    expect(summary.house).toBe('Smith');
    expect(typeof summary.weekStarting).toBe('string');
    expect(summary.kids).toHaveLength(1);
    expect(summary.kids[0].name).toBe('Mia');
    expect(summary.kids[0].pct).toBeGreaterThanOrEqual(0);
    expect(summary.kids[0].pct).toBeLessThanOrEqual(100);
    expect(typeof summary.kids[0].streak).toBe('number');
    expect(Array.isArray(summary.kids[0].badges)).toBe(true);
  });
});
