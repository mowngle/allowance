import { db, schema } from '$lib/server/db';

export function seedFamily(name = 'Test Fam'): string {
  const id = crypto.randomUUID();
  db.insert(schema.families).values({ id, name, payoutDay: 0, createdAt: Date.now() }).run();
  return id;
}

export function seedKid(familyId: string, name: string, birthdate = '2016-01-01'): string {
  const id = crypto.randomUUID();
  db.insert(schema.persons)
    .values({ id, familyId, name, role: 'kid', birthdate, createdAt: Date.now() })
    .run();
  return id;
}

export function seedChore(familyId: string, assigneeId: string, name = 'Chore'): string {
  const id = crypto.randomUUID();
  db.insert(schema.chores)
    .values({
      id,
      familyId,
      assigneeId,
      name,
      recurrence: JSON.stringify({ kind: 'daily' }),
      expiryRule: 'vanish',
      active: true,
      createdAt: Date.now(),
    })
    .run();
  return id;
}

export function seedInstance(
  choreId: string,
  dueDate: string,
  status: 'pending' | 'done' | 'confirmed' | 'disputed',
  markedDoneAt: number | null = null
): string {
  const id = crypto.randomUUID();
  db.insert(schema.choreInstances)
    .values({ id, choreId, dueDate, status, markedDoneAt: markedDoneAt ?? undefined })
    .run();
  return id;
}
