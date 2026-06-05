// Step 3: add kids one at a time. List shows kids added so far + form to add another.
// "Done adding kids" button proceeds to step 4.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { getOrInitOnlyFamily } from '$lib/server/setup';

export const load: PageServerLoad = async () => {
  const fam = await getOrInitOnlyFamily();
  if (!fam) throw redirect(303, '/setup');
  if (!fam.hasParent) throw redirect(303, '/setup/parent');

  const kids = await db
    .select({
      id: schema.persons.id,
      name: schema.persons.name,
      birthdate: schema.persons.birthdate,
    })
    .from(schema.persons)
    .where(and(eq(schema.persons.familyId, fam.id), eq(schema.persons.role, 'kid')));

  return { kids };
};

export const actions: Actions = {
  add: async ({ request }) => {
    const fam = await getOrInitOnlyFamily();
    if (!fam) throw redirect(303, '/setup');

    const data = await request.formData();
    const name = (data.get('name')?.toString() ?? '').trim();
    const birthdate = (data.get('birthdate')?.toString() ?? '').trim();
    if (!name) return fail(400, { error: 'Name is required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) {
      return fail(400, { error: 'Birthdate must be YYYY-MM-DD' });
    }

    db.insert(schema.persons)
      .values({
        id: crypto.randomUUID(),
        familyId: fam.id,
        name,
        role: 'kid',
        birthdate,
        createdAt: Date.now(),
      })
      .run();

    return { ok: true };
  },
};
