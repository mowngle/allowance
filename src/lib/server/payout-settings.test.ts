import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import { seedFamily, seedKid } from '$lib/server/test/seed';
import { saveFamilyDefault, saveKidOverride, clearKidOverride } from './payout-settings';

describe('payout-settings mutations', () => {
  it('saveFamilyDefault writes the four columns', async () => {
    const fam = seedFamily('Fam');
    await saveFamilyDefault(fam, { mode: 'fixed', rateCents: 0, bonusCents: 0, fixedCents: 2000 });
    const row = (await db
      .select({
        mode: schema.families.payoutMode,
        fixed: schema.families.payoutFixedCents,
      })
      .from(schema.families)
      .where(eq(schema.families.id, fam))
      .limit(1))[0];
    expect(row).toEqual({ mode: 'fixed', fixed: 2000 });
  });

  it('saveKidOverride stores JSON; clearKidOverride nulls it', async () => {
    const fam = seedFamily('Fam');
    const kid = seedKid(fam, 'Kid');
    await saveKidOverride(fam, kid, { mode: 'fixed', centsPerYear: 0, bonusCents: 0, fixedCents: 1500 });
    let ov = (await db.select({ ov: schema.persons.payoutOverride }).from(schema.persons).where(eq(schema.persons.id, kid)).limit(1))[0].ov;
    expect(JSON.parse(ov!)).toEqual({ mode: 'fixed', centsPerYear: 0, bonusCents: 0, fixedCents: 1500 });
    await clearKidOverride(fam, kid);
    ov = (await db.select({ ov: schema.persons.payoutOverride }).from(schema.persons).where(eq(schema.persons.id, kid)).limit(1))[0].ov;
    expect(ov).toBeNull();
  });

  it('kid mutations are scoped to the family (no cross-family edit)', async () => {
    const famA = seedFamily('A');
    const famB = seedFamily('B');
    const kidB = seedKid(famB, 'KidB');
    // famA tries to override famB's kid — must not take effect.
    await saveKidOverride(famA, kidB, { mode: 'fixed', centsPerYear: 0, bonusCents: 0, fixedCents: 9999 });
    const ov = (await db.select({ ov: schema.persons.payoutOverride }).from(schema.persons).where(eq(schema.persons.id, kidB)).limit(1))[0].ov;
    expect(ov).toBeNull();
  });
});
