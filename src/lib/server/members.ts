// Family member management: add/edit kids & co-parents, archive (never delete),
// and record explicit setup completion. Shared by /settings/members and the
// /setup/members wizard step.

import { and, eq } from 'drizzle-orm';
import { db, schema } from './db';
import { setConfig } from './config';

export type MemberRow = {
  id: string;
  name: string;
  birthdate: string | null;
  active: boolean;
  hasPin?: boolean; // parents only
};

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function listMembers(
  familyId: string
): Promise<{ parents: MemberRow[]; kids: MemberRow[] }> {
  const rows = await db
    .select({
      id: schema.persons.id,
      name: schema.persons.name,
      role: schema.persons.role,
      birthdate: schema.persons.birthdate,
      active: schema.persons.active,
      parentPinHash: schema.persons.parentPinHash,
    })
    .from(schema.persons)
    .where(eq(schema.persons.familyId, familyId));

  const parents = rows
    .filter((r) => r.role === 'parent')
    .map((r) => ({ id: r.id, name: r.name, birthdate: r.birthdate, active: r.active, hasPin: r.parentPinHash != null }));
  const kids = rows
    .filter((r) => r.role === 'kid')
    .map((r) => ({ id: r.id, name: r.name, birthdate: r.birthdate, active: r.active }));
  return { parents, kids };
}

export async function addKid(input: { familyId: string; name: string; birthdate: string }): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('Name is required');
  if (!isIsoDate(input.birthdate)) throw new Error('Birthdate must be YYYY-MM-DD');
  const id = crypto.randomUUID();
  db.insert(schema.persons)
    .values({ id, familyId: input.familyId, name, role: 'kid', birthdate: input.birthdate, active: true, createdAt: Date.now() })
    .run();
  return id;
}

export async function addParent(input: { familyId: string; name: string }): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('Name is required');
  const id = crypto.randomUUID();
  db.insert(schema.persons)
    .values({ id, familyId: input.familyId, name, role: 'parent', active: true, createdAt: Date.now() })
    .run();
  return id;
}

async function findInFamily(id: string, familyId: string) {
  const rows = await db
    .select({ id: schema.persons.id, familyId: schema.persons.familyId, role: schema.persons.role })
    .from(schema.persons)
    .where(eq(schema.persons.id, id))
    .limit(1);
  const m = rows[0];
  if (!m || m.familyId !== familyId) throw new Error('Member not found');
  return m;
}

export async function editMember(input: { id: string; familyId: string; name: string; birthdate?: string }): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new Error('Name is required');
  const member = await findInFamily(input.id, input.familyId);
  const patch: { name: string; birthdate?: string } = { name };
  if (member.role === 'kid' && input.birthdate !== undefined) {
    if (!isIsoDate(input.birthdate)) throw new Error('Birthdate must be YYYY-MM-DD');
    patch.birthdate = input.birthdate;
  }
  db.update(schema.persons).set(patch).where(eq(schema.persons.id, input.id)).run();
}

export async function archiveMember(input: { id: string; familyId: string }): Promise<void> {
  const member = await findInFamily(input.id, input.familyId);
  if (member.role === 'parent') {
    const actives = await db
      .select({ id: schema.persons.id })
      .from(schema.persons)
      .where(and(
        eq(schema.persons.familyId, input.familyId),
        eq(schema.persons.role, 'parent'),
        eq(schema.persons.active, true),
      ));
    const remaining = actives.filter((a) => a.id !== input.id);
    if (remaining.length === 0) throw new Error("You can't archive the only parent");
  }
  db.update(schema.persons).set({ active: false }).where(eq(schema.persons.id, input.id)).run();
}

export async function restoreMember(input: { id: string; familyId: string }): Promise<void> {
  await findInFamily(input.id, input.familyId);
  db.update(schema.persons).set({ active: true }).where(eq(schema.persons.id, input.id)).run();
}

export async function completeSetup(): Promise<void> {
  await setConfig('setup_completed', '1');
}
