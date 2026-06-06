// Per-kid permission to post canned cheers to the cross-home wall. Parent-managed,
// default off (see persons.can_post_cheers).

import { and, eq } from 'drizzle-orm';
import { db, schema } from './db';

export async function canPostCheers(personId: string): Promise<boolean> {
  const rows = await db
    .select({ role: schema.persons.role, canPostCheers: schema.persons.canPostCheers })
    .from(schema.persons)
    .where(eq(schema.persons.id, personId))
    .limit(1);
  const r = rows[0];
  return r?.role === 'kid' && !!r.canPostCheers;
}

export type KidCheerPerm = { id: string; name: string; canPostCheers: boolean };

export async function listKidCheerPerms(familyId: string): Promise<KidCheerPerm[]> {
  const rows = await db
    .select({
      id: schema.persons.id,
      name: schema.persons.name,
      canPostCheers: schema.persons.canPostCheers,
    })
    .from(schema.persons)
    .where(and(eq(schema.persons.familyId, familyId), eq(schema.persons.role, 'kid')));
  return rows.map((r) => ({ id: r.id, name: r.name, canPostCheers: !!r.canPostCheers }));
}

export async function setKidCheerPerm(personId: string, allowed: boolean): Promise<void> {
  db.update(schema.persons)
    .set({ canPostCheers: allowed })
    .where(eq(schema.persons.id, personId))
    .run();
}
