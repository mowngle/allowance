// Chore CRUD operations + recurrence parsing helpers.

import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from './db';

export type RecurrenceForm = {
  kind: 'daily' | 'weekly' | 'by-end-of-week';
  days?: number[]; // 0-6, required for 'weekly', sorted
};

export function recurrenceFromForm(form: RecurrenceForm): string {
  if (form.kind === 'weekly') {
    const days = Array.from(new Set(form.days ?? []))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      .sort((a, b) => a - b);
    if (days.length === 0) {
      throw new Error('Pick at least one day');
    }
    return JSON.stringify({ kind: 'weekly', days });
  }
  return JSON.stringify({ kind: form.kind });
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Read a weekly recurrence into a normalized day list. Handles legacy shapes. */
export function weeklyDays(r: any): number[] {
  if (Array.isArray(r?.days)) return r.days.slice().sort((a: number, b: number) => a - b);
  if (typeof r?.day === 'number') return [r.day];
  return [];
}

export function recurrencePretty(raw: string): string {
  try {
    const r = JSON.parse(raw);
    switch (r.kind) {
      case 'daily':
        return 'Daily';
      case 'weekdays':
        // Legacy data only — equivalent to weekly Mon–Fri.
        return 'Weekdays (Mon–Fri)';
      case 'by-end-of-week':
        return 'By end of week (due Sat)';
      case 'weekly': {
        const days = weeklyDays(r);
        if (days.length === 0) return 'Weekly · ?';
        if (days.length === 7) return 'Every day';
        if (days.length === 5 && days.join(',') === '1,2,3,4,5') return 'Weekdays (Mon–Fri)';
        if (days.length === 2 && days.join(',') === '0,6') return 'Weekends';
        return 'Weekly · ' + days.map((d) => DAY_SHORT[d]).join(', ');
      }
    }
  } catch {}
  return 'Unknown';
}

export type ChoreAdminView = {
  id: string;
  assigneeId: string;
  assigneeName: string;
  name: string;
  recurrence: string; // raw JSON
  recurrencePretty: string;
  expiryRule: 'vanish' | 'roll_forward';
  active: boolean;
};

export async function getFamilyChores(familyId: string): Promise<ChoreAdminView[]> {
  const rows = await db
    .select({
      id: schema.chores.id,
      assigneeId: schema.chores.assigneeId,
      assigneeName: schema.persons.name,
      name: schema.chores.name,
      recurrence: schema.chores.recurrence,
      expiryRule: schema.chores.expiryRule,
      active: schema.chores.active,
    })
    .from(schema.chores)
    .innerJoin(schema.persons, eq(schema.persons.id, schema.chores.assigneeId))
    .where(eq(schema.chores.familyId, familyId))
    .orderBy(asc(schema.persons.name), asc(schema.chores.name));

  return rows.map((r) => ({
    id: r.id,
    assigneeId: r.assigneeId,
    assigneeName: r.assigneeName,
    name: r.name,
    recurrence: r.recurrence,
    recurrencePretty: recurrencePretty(r.recurrence),
    expiryRule: r.expiryRule as 'vanish' | 'roll_forward',
    active: !!r.active,
  }));
}

export type CreateChoreInput = {
  familyId: string;
  assigneeId: string;
  name: string;
  recurrenceForm: RecurrenceForm;
  expiryRule: 'vanish' | 'roll_forward';
};

export async function createChore(input: CreateChoreInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('Name is required');

  // Assignee must be a kid in this family
  const rows = await db
    .select({ familyId: schema.persons.familyId, role: schema.persons.role })
    .from(schema.persons)
    .where(eq(schema.persons.id, input.assigneeId))
    .limit(1);
  if (!rows[0] || rows[0].familyId !== input.familyId || rows[0].role !== 'kid') {
    throw new Error('Bad assignee');
  }

  const id = crypto.randomUUID();
  db.insert(schema.chores)
    .values({
      id,
      familyId: input.familyId,
      assigneeId: input.assigneeId,
      name,
      recurrence: recurrenceFromForm(input.recurrenceForm),
      expiryRule: input.expiryRule,
      active: true,
      createdAt: Date.now(),
    })
    .run();
  return id;
}

export type UpdateChoreInput = {
  familyId: string;
  choreId: string;
  name?: string;
  assigneeId?: string;
  recurrenceForm?: RecurrenceForm;
  expiryRule?: 'vanish' | 'roll_forward';
  active?: boolean;
};

export async function updateChore(input: UpdateChoreInput): Promise<void> {
  // Verify chore belongs to family
  const rows = await db
    .select({ familyId: schema.chores.familyId })
    .from(schema.chores)
    .where(eq(schema.chores.id, input.choreId))
    .limit(1);
  if (!rows[0] || rows[0].familyId !== input.familyId) throw new Error('Not your chore');

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) throw new Error('Name cannot be blank');
    patch.name = n;
  }
  if (input.assigneeId !== undefined) {
    const ar = await db
      .select({ familyId: schema.persons.familyId, role: schema.persons.role })
      .from(schema.persons)
      .where(eq(schema.persons.id, input.assigneeId))
      .limit(1);
    if (!ar[0] || ar[0].familyId !== input.familyId || ar[0].role !== 'kid') {
      throw new Error('Bad assignee');
    }
    patch.assigneeId = input.assigneeId;
  }
  if (input.recurrenceForm) patch.recurrence = recurrenceFromForm(input.recurrenceForm);
  if (input.expiryRule) patch.expiryRule = input.expiryRule;
  if (input.active !== undefined) patch.active = input.active;

  if (Object.keys(patch).length === 0) return;

  db.update(schema.chores)
    .set(patch)
    .where(eq(schema.chores.id, input.choreId))
    .run();
}

/**
 * Soft delete by setting active=false. We don't hard-delete because
 * chore_instances reference the chore and we want history to survive.
 */
export async function deactivateChore(familyId: string, choreId: string): Promise<void> {
  await updateChore({ familyId, choreId, active: false });
}
