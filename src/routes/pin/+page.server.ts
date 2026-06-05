// /pin — parent enters their PIN to verify this device.
// On success, redirects to ?return=... (or /).

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import { verifyAndMarkPin, parentHasPin } from '$lib/server/pin';

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.session) throw redirect(303, '/claim');
  if (locals.session.role !== 'parent') throw error(403, 'Parents only');
  const hasPin = await parentHasPin(locals.session.personId);
  if (!hasPin) {
    // No PIN set; nothing to enter. Send them to settings to set one if they want.
    throw redirect(303, url.searchParams.get('return') || '/');
  }
  return {
    returnPath: url.searchParams.get('return') || '/',
  };
};

export const actions: Actions = {
  default: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const data = await request.formData();
    const pin = data.get('pin')?.toString() ?? '';
    const returnPath = data.get('return')?.toString() || '/';
    const ok = await verifyAndMarkPin(
      locals.session.personId,
      locals.session.deviceId,
      pin
    );
    if (!ok) {
      return fail(400, { error: 'Wrong PIN' });
    }
    throw redirect(303, returnPath);
  },
};
