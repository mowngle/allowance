import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { createChore, type RecurrenceForm } from '$lib/server/choreAdmin';
import { requireFreshPin } from '$lib/server/pinGuard';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.session) throw redirect(303, '/claim');
  if (locals.session.role !== 'parent') throw error(403, 'Parents only');
  await requireFreshPin(locals.session, '/chores/new');

  const kids = await db
    .select({ id: schema.persons.id, name: schema.persons.name })
    .from(schema.persons)
    .where(
      and(
        eq(schema.persons.familyId, locals.session.familyId),
        eq(schema.persons.role, 'kid')
      )
    );

  return { kids };
};

export const actions: Actions = {
  default: async ({ locals, request }) => {
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

    if (!assigneeId) return fail(400, { error: 'Pick who it belongs to' });
    if (!name.trim()) return fail(400, { error: 'Name is required' });

    try {
      await createChore({
        familyId: locals.session.familyId,
        assigneeId,
        name,
        recurrenceForm: { kind, days },
        expiryRule,
      });
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    throw redirect(303, '/chores');
  },
};
