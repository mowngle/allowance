// Helpers for the first-run setup wizard.
//
// "Setup complete" = at least one family with at least one parent.
// Kids are optional at setup time (can be added later from /chores admin →
// add kid flow when we build that, or by re-running setup).

import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from './db';

export async function isSetupComplete(): Promise<boolean> {
  const fams = await db
    .select({ id: schema.families.id })
    .from(schema.families)
    .limit(1);
  if (fams.length === 0) return false;
  const parents = await db
    .select({ id: schema.persons.id })
    .from(schema.persons)
    .where(eq(schema.persons.role, 'parent'))
    .limit(1);
  return parents.length > 0;
}

export async function getOrInitOnlyFamily(): Promise<{
  id: string;
  hasParent: boolean;
  hasKid: boolean;
} | null> {
  const fams = await db.select().from(schema.families).limit(1);
  const fam = fams[0];
  if (!fam) return null;

  const parents = await db
    .select({ id: schema.persons.id })
    .from(schema.persons)
    .where(and(eq(schema.persons.familyId, fam.id), eq(schema.persons.role, 'parent')))
    .limit(1);

  const kids = await db
    .select({ id: schema.persons.id })
    .from(schema.persons)
    .where(and(eq(schema.persons.familyId, fam.id), eq(schema.persons.role, 'kid')))
    .limit(1);

  return {
    id: fam.id,
    hasParent: parents.length > 0,
    hasKid: kids.length > 0,
  };
}

export async function getFirstParent(familyId: string): Promise<{ id: string; name: string } | null> {
  const rows = await db
    .select({ id: schema.persons.id, name: schema.persons.name })
    .from(schema.persons)
    .where(and(eq(schema.persons.familyId, familyId), eq(schema.persons.role, 'parent')))
    .limit(1);
  return rows[0] ?? null;
}
