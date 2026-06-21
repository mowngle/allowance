import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import { seedFamily, seedKid } from '$lib/server/test/seed';

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
