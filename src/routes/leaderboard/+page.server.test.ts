import { describe, it, expect } from 'vitest';
import { load } from './+page.server';
import { todayIso } from '$lib/server/dates';
import { seedFamily, seedKid, seedChore, seedInstance } from '$lib/server/test/seed';

// Minimal RequestEvent stand-in: load only reads locals.session.
function ev(session: unknown) {
  return { locals: { session } } as unknown as Parameters<typeof load>[0];
}

describe('leaderboard load — solo household (no scoreboard connection)', () => {
  it('ranks the local kids, reports no rivals, and shows no Cup', async () => {
    const fam = seedFamily('Solo Fam');
    const amy = seedKid(fam, 'Amy');
    const ben = seedKid(fam, 'Ben');
    const amyChore = seedChore(fam, amy);
    const benChore1 = seedChore(fam, ben);
    const benChore2 = seedChore(fam, ben);
    const today = todayIso();
    // Amy: 1/1 confirmed = 100%. Ben: 1 confirmed + 1 pending = 50%. (today is always
    // inside the current responsibility week, so pct is deterministic regardless of weekday.)
    seedInstance(amyChore, today, 'confirmed');
    seedInstance(benChore1, today, 'confirmed');
    seedInstance(benChore2, today, 'pending');

    const data = await load(
      ev({ familyId: fam, role: 'parent', personId: 'parent-1', personName: 'Parent' })
    );

    expect(data.connected).toBe(false);
    expect(data.unreachable).toBe(false);
    expect(data.hasRivals).toBe(false);
    expect(data.cup).toBeNull();
    expect(data.cheers).toEqual([]);
    expect(data.ranked.map((k) => k.name)).toEqual(['Amy', 'Ben']); // 100% before 50%
    expect(data.ranked[0].rank).toBe(1);
    expect(data.ranked[0].house).toBe('Solo Fam');
  });
});
