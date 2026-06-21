import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import { seedFamily, seedKid } from '$lib/server/test/seed';
import { getCurrentWeekReview } from '$lib/server/payouts';
import { ageOn, todayIso } from '$lib/server/dates';

describe('payout config schema defaults', () => {
  it('new families default to the age × $1 scheme', async () => {
    const fam = seedFamily('Defaults Fam');
    const row = (await db
      .select({
        mode: schema.families.payoutMode,
        cpy: schema.families.payoutCentsPerYear,
        bonus: schema.families.payoutBonusCents,
        fixed: schema.families.payoutFixedCents,
      })
      .from(schema.families)
      .where(eq(schema.families.id, fam))
      .limit(1))[0];
    expect(row).toEqual({ mode: 'age', cpy: 100, bonus: 0, fixed: 0 });
  });

  it('new kids have a null payout_override', async () => {
    const fam = seedFamily('Defaults Fam');
    const kid = seedKid(fam, 'Kid');
    const row = (await db
      .select({ ov: schema.persons.payoutOverride })
      .from(schema.persons)
      .where(eq(schema.persons.id, kid))
      .limit(1))[0];
    expect(row.ov).toBeNull();
  });
});

describe('getCurrentWeekReview honors payout config', () => {
  it('default family → age × $1', async () => {
    const fam = seedFamily('Age Fam');
    const kid = seedKid(fam, 'Amy', '2016-01-01');
    const age = ageOn('2016-01-01', todayIso());
    const items = await getCurrentWeekReview(fam);
    const item = items.find((i) => i.kidId === kid)!;
    expect(item.suggestedAmountCents).toBe(age * 100);
  });

  it('fixed family default → flat amount, age ignored', async () => {
    const fam = seedFamily('Fixed Fam');
    const kid = seedKid(fam, 'Ben', '2010-01-01');
    db.update(schema.families)
      .set({ payoutMode: 'fixed', payoutFixedCents: 2500 })
      .where(eq(schema.families.id, fam))
      .run();
    const items = await getCurrentWeekReview(fam);
    expect(items.find((i) => i.kidId === kid)!.suggestedAmountCents).toBe(2500);
  });

  it('per-kid override wins; sibling without one uses family default', async () => {
    const fam = seedFamily('Mixed Fam');
    const a = seedKid(fam, 'Mia', '2016-01-01'); // override → fixed 1500
    const b = seedKid(fam, 'Leo', '2014-01-01'); // inherits age × $1
    db.update(schema.persons)
      .set({ payoutOverride: '{"mode":"fixed","centsPerYear":0,"bonusCents":0,"fixedCents":1500}' })
      .where(eq(schema.persons.id, a))
      .run();
    const items = await getCurrentWeekReview(fam);
    expect(items.find((i) => i.kidId === a)!.suggestedAmountCents).toBe(1500);
    expect(items.find((i) => i.kidId === b)!.suggestedAmountCents).toBe(
      ageOn('2014-01-01', todayIso()) * 100
    );
  });
});
