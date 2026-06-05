// /review — parent-only. Sunday review: per-kid weekly summary + approve/skip.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import { getCurrentWeekReview, approvePayout, skipPayout } from '$lib/server/payouts';
import { requireFreshPin } from '$lib/server/pinGuard';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.session) throw redirect(303, '/claim');
  if (locals.session.role !== 'parent') throw error(403, 'Parents only');
  await requireFreshPin(locals.session, '/review');
  const items = await getCurrentWeekReview(locals.session.familyId);
  return { items };
};

export const actions: Actions = {
  approve: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const data = await request.formData();
    const cycleId = data.get('cycleId')?.toString();
    const amountStr = data.get('amountCents')?.toString();
    const note = data.get('note')?.toString();
    if (!cycleId || !amountStr) return fail(400, { error: 'Missing fields' });
    const amount = parseInt(amountStr, 10);
    if (Number.isNaN(amount) || amount < 0) return fail(400, { error: 'Bad amount' });

    try {
      await approvePayout(locals.session.personId, cycleId, amount, note);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { ok: true };
  },

  skip: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const data = await request.formData();
    const cycleId = data.get('cycleId')?.toString();
    const note = data.get('note')?.toString();
    if (!cycleId) return fail(400, { error: 'Missing cycleId' });

    try {
      await skipPayout(locals.session.personId, cycleId, note);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { ok: true };
  },
};
