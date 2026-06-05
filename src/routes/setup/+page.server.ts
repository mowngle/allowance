// Step 1: family name + review day.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db';
import { getOrInitOnlyFamily } from '$lib/server/setup';

export const load: PageServerLoad = async () => {
  const fam = await getOrInitOnlyFamily();
  if (fam) {
    // Family exists; jump to whatever step is next.
    if (!fam.hasParent) throw redirect(303, '/setup/parent');
    throw redirect(303, '/setup/kids');
  }
  return {};
};

export const actions: Actions = {
  default: async ({ request }) => {
    const data = await request.formData();
    const name = (data.get('name')?.toString() ?? '').trim();
    const dayStr = data.get('payoutDay')?.toString() ?? '0';
    const payoutDay = parseInt(dayStr, 10);
    if (!name) return fail(400, { error: 'Family name is required' });
    if (Number.isNaN(payoutDay) || payoutDay < 0 || payoutDay > 6) {
      return fail(400, { error: 'Invalid review day' });
    }
    // Allow only if no family yet.
    const existing = await getOrInitOnlyFamily();
    if (existing) throw redirect(303, '/setup/parent');

    const now = Date.now();
    db.insert(schema.families)
      .values({ id: crypto.randomUUID(), name, payoutDay, createdAt: now })
      .run();
    throw redirect(303, '/setup/parent');
  },
};
