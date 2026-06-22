// Step 2: first parent name + optional PIN.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db';
import { getOrInitOnlyFamily } from '$lib/server/setup';
import { setParentPin } from '$lib/server/pin';

export const load: PageServerLoad = async () => {
  const fam = await getOrInitOnlyFamily();
  if (!fam) throw redirect(303, '/setup');
  if (fam.hasParent) throw redirect(303, '/setup/members');
  return { familyId: fam.id };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const fam = await getOrInitOnlyFamily();
    if (!fam) throw redirect(303, '/setup');
    if (fam.hasParent) throw redirect(303, '/setup/members');

    const data = await request.formData();
    const name = (data.get('name')?.toString() ?? '').trim();
    const pin = data.get('pin')?.toString() ?? '';
    const pin2 = data.get('pin2')?.toString() ?? '';
    if (!name) return fail(400, { error: 'Name is required' });
    if (pin || pin2) {
      if (pin !== pin2) return fail(400, { error: "PINs don't match" });
      if (pin.length < 4) return fail(400, { error: 'PIN must be at least 4 characters' });
    }

    const parentId = crypto.randomUUID();
    db.insert(schema.persons)
      .values({
        id: parentId,
        familyId: fam.id,
        name,
        role: 'parent',
        createdAt: Date.now(),
      })
      .run();

    if (pin) {
      try {
        await setParentPin(parentId, pin);
      } catch (e) {
        return fail(400, { error: (e as Error).message });
      }
    }

    throw redirect(303, '/setup/members');
  },
};
