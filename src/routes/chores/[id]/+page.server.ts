import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { updateChore, type RecurrenceForm, weeklyDays } from '$lib/server/choreAdmin';
import { requireFreshPin } from '$lib/server/pinGuard';

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!locals.session) throw redirect(303, '/claim');
  if (locals.session.role !== 'parent') throw error(403, 'Parents only');
  await requireFreshPin(locals.session, `/chores/${params.id}`);

  const rows = await db
    .select()
    .from(schema.chores)
    .where(eq(schema.chores.id, params.id))
    .limit(1);
  const chore = rows[0];
  if (!chore) throw error(404, 'Chore not found');
  if (chore.familyId !== locals.session.familyId) throw error(403, 'Different family');

  const kids = await db
    .select({ id: schema.persons.id, name: schema.persons.name })
    .from(schema.persons)
    .where(
      and(
        eq(schema.persons.familyId, locals.session.familyId),
        eq(schema.persons.role, 'kid'),
        eq(schema.persons.active, true)
      )
    );

  let recKind: RecurrenceForm['kind'] = 'daily';
  let recDays: number[] = [];
  try {
    const r = JSON.parse(chore.recurrence);
    // Migrate legacy 'weekdays' kind on read → present as weekly Mon-Fri.
    if (r.kind === 'weekdays') {
      recKind = 'weekly';
      recDays = [1, 2, 3, 4, 5];
    } else if (r.kind === 'weekly') {
      recKind = 'weekly';
      recDays = weeklyDays(r);
    } else if (r.kind === 'daily' || r.kind === 'by-end-of-week') {
      recKind = r.kind;
    }
  } catch {}

  return {
    chore: {
      id: chore.id,
      name: chore.name,
      assigneeId: chore.assigneeId,
      expiryRule: chore.expiryRule as 'vanish' | 'roll_forward',
      active: !!chore.active,
    },
    recKind,
    recDays,
    kids,
  };
};

export const actions: Actions = {
  save: async ({ locals, request, params }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const data = await request.formData();
    const name = data.get('name')?.toString() ?? '';
    const assigneeId = data.get('assigneeId')?.toString() ?? '';
    const kind = (data.get('recurrenceKind')?.toString() ?? 'daily') as RecurrenceForm['kind'];
    const daysCsv = data.get('recurrenceDays')?.toString() ?? '';
    const days = daysCsv
      ? daysCsv.split(',').map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n))
      : [];
    const expiryRule = (data.get('expiryRule')?.toString() ?? 'vanish') as
      | 'vanish'
      | 'roll_forward';

    try {
      await updateChore({
        familyId: locals.session.familyId,
        choreId: params.id,
        name,
        assigneeId,
        recurrenceForm: { kind, days },
        expiryRule,
      });
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    throw redirect(303, '/chores');
  },

  toggleActive: async ({ locals, request, params }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const data = await request.formData();
    const active = data.get('active') === 'true';
    try {
      await updateChore({
        familyId: locals.session.familyId,
        choreId: params.id,
        active,
      });
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    throw redirect(303, '/chores');
  },
};
