// /chores — parent-only list of all chores in the family, grouped by kid.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { getFamilyChores, updateChore } from '$lib/server/choreAdmin';
import { requireFreshPin } from '$lib/server/pinGuard';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.session) throw redirect(303, '/claim');
  if (locals.session.role !== 'parent') throw error(403, 'Parents only');
  await requireFreshPin(locals.session, '/chores');

  const [chores, kids] = await Promise.all([
    getFamilyChores(locals.session.familyId),
    db
      .select({ id: schema.persons.id, name: schema.persons.name })
      .from(schema.persons)
      .where(
        and(
          eq(schema.persons.familyId, locals.session.familyId),
          eq(schema.persons.role, 'kid')
        )
      ),
  ]);

  return { chores, kids };
};

export const actions: Actions = {
  toggleActive: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const data = await request.formData();
    const choreId = data.get('choreId')?.toString();
    const active = data.get('active') === 'true';
    if (!choreId) return fail(400, { error: 'Missing choreId' });

    try {
      await updateChore({
        familyId: locals.session.familyId,
        choreId,
        active,
      });
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { ok: true };
  },
};
