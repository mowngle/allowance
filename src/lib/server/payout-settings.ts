// Family-scoped payout-config mutations. The route layer parses the form and
// calls these; kid edits are scoped to familyId so a parent can't touch another
// family's kid.

import { and, eq } from 'drizzle-orm';
import { db, schema } from './db';
import type { PayoutMode } from './payout-config';

export async function saveFamilyDefault(
  familyId: string,
  input: { mode: PayoutMode; rateCents: number; bonusCents: number; fixedCents: number }
): Promise<void> {
  db.update(schema.families)
    .set({
      payoutMode: input.mode,
      payoutCentsPerYear: input.rateCents,
      payoutBonusCents: input.bonusCents,
      payoutFixedCents: input.fixedCents,
    })
    .where(eq(schema.families.id, familyId))
    .run();
}

export async function saveKidOverride(
  familyId: string,
  kidId: string,
  cfg: { mode: PayoutMode; centsPerYear: number; bonusCents: number; fixedCents: number }
): Promise<void> {
  db.update(schema.persons)
    .set({ payoutOverride: JSON.stringify(cfg) })
    .where(and(eq(schema.persons.id, kidId), eq(schema.persons.familyId, familyId)))
    .run();
}

export async function clearKidOverride(familyId: string, kidId: string): Promise<void> {
  db.update(schema.persons)
    .set({ payoutOverride: null })
    .where(and(eq(schema.persons.id, kidId), eq(schema.persons.familyId, familyId)))
    .run();
}
