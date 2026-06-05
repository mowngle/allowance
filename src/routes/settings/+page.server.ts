// /settings — parent-only. Set/change/clear PIN.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import {
  parentHasPin,
  setParentPin,
  clearParentPin,
  verifyPinHash,
} from '$lib/server/pin';
import { requireFreshPin } from '$lib/server/pinGuard';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.session) throw redirect(303, '/claim');
  if (locals.session.role !== 'parent') throw error(403, 'Parents only');
  // If a PIN is already set, gate this page behind a fresh PIN.
  // If not, allow free access so the parent can set one for the first time.
  if (await parentHasPin(locals.session.personId)) {
    await requireFreshPin(locals.session, '/settings');
  }
  return {
    hasPin: await parentHasPin(locals.session.personId),
  };
};

export const actions: Actions = {
  setPin: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const data = await request.formData();
    const pin = data.get('pin')?.toString() ?? '';
    const pin2 = data.get('pin2')?.toString() ?? '';
    if (pin !== pin2) return fail(400, { error: "PINs don't match" });
    try {
      await setParentPin(locals.session.personId, pin);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { ok: true, message: 'PIN saved.' };
  },

  clearPin: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const data = await request.formData();
    const currentPin = data.get('currentPin')?.toString() ?? '';
    const rows = await db
      .select({ hash: schema.persons.parentPinHash })
      .from(schema.persons)
      .where(eq(schema.persons.id, locals.session.personId))
      .limit(1);
    const hash = rows[0]?.hash;
    if (!hash) return fail(400, { error: 'No PIN set.' });
    const ok = await verifyPinHash(currentPin, hash);
    if (!ok) return fail(400, { error: 'Wrong current PIN.' });
    await clearParentPin(locals.session.personId);
    return { ok: true, message: 'PIN cleared.' };
  },
};
