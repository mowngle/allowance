import { describe, it, expect } from 'vitest';
import { seedFamily, seedChore, seedInstance } from './test/seed';
import { addKid, addParent, archiveMember } from './members';
import { getKidSummaries, getPendingApprovals } from './family';
import { listKidCheerPerms } from './cheers';
import { getCurrentWeekReview } from './payouts';
import { getOrInitOnlyFamily } from './setup';
import { todayIso } from './dates';

describe('archived members are excluded from active views', () => {
  it('getKidSummaries omits an archived kid', async () => {
    const fam = seedFamily();
    const a = await addKid({ familyId: fam, name: 'A', birthdate: '2016-01-01' });
    const b = await addKid({ familyId: fam, name: 'B', birthdate: '2016-01-01' });
    await archiveMember({ id: b, familyId: fam });
    const ids = (await getKidSummaries(fam)).map((k) => k.personId);
    expect(ids).toEqual([a]);
  });

  it('listKidCheerPerms omits an archived kid', async () => {
    const fam = seedFamily();
    const a = await addKid({ familyId: fam, name: 'A', birthdate: '2016-01-01' });
    const b = await addKid({ familyId: fam, name: 'B', birthdate: '2016-01-01' });
    await archiveMember({ id: b, familyId: fam });
    const ids = (await listKidCheerPerms(fam)).map((k) => k.id);
    expect(ids).toEqual([a]);
  });

  it('getCurrentWeekReview omits an archived kid', async () => {
    const fam = seedFamily();
    const a = await addKid({ familyId: fam, name: 'A', birthdate: '2016-01-01' });
    const b = await addKid({ familyId: fam, name: 'B', birthdate: '2016-01-01' });
    await archiveMember({ id: b, familyId: fam });
    const review = await getCurrentWeekReview(fam);
    expect(review.map((k) => k.kidId)).toEqual([a]);
  });

  it('getOrInitOnlyFamily.hasKid is false when the only kid is archived', async () => {
    const fam = seedFamily();
    const k = await addKid({ familyId: fam, name: 'A', birthdate: '2016-01-01' });
    await addParent({ familyId: fam, name: 'Dad' });
    await archiveMember({ id: k, familyId: fam });
    const info = await getOrInitOnlyFamily();
    expect(info?.hasKid).toBe(false);
    expect(info?.hasParent).toBe(true);
  });

  it('getPendingApprovals omits an archived kid\'s done chore', async () => {
    const fam = seedFamily();
    const a = await addKid({ familyId: fam, name: 'A', birthdate: '2016-01-01' });
    const b = await addKid({ familyId: fam, name: 'B', birthdate: '2016-01-01' });
    const choreA = seedChore(fam, a);
    const choreB = seedChore(fam, b);
    seedInstance(choreA, todayIso(), 'done', Date.now());
    seedInstance(choreB, todayIso(), 'done', Date.now());
    await archiveMember({ id: b, familyId: fam });
    const approvals = await getPendingApprovals(fam);
    const kidIds = approvals.map((x) => x.kidId);
    expect(kidIds).toContain(a);
    expect(kidIds).not.toContain(b);
  });
});
