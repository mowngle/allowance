// /review — parent-only. Weekly review: per-kid weekly summary + approve/skip.
// Every week the parent never finalized is still here, newest first, with older
// weeks collapsed into one bulk-actionable group — a forgotten week stays
// payable rather than vanishing.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import {
  getReviewQueue,
  approvePayout,
  skipPayout,
  approvePayoutBatch,
  skipPayoutBatch,
} from '$lib/server/payouts';
import { requireFreshPin } from '$lib/server/pinGuard';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.session) throw redirect(303, '/claim');
  if (locals.session.role !== 'parent') throw error(403, 'Parents only');
  await requireFreshPin(locals.session, '/review');
  const queue = await getReviewQueue(locals.session.familyId);
  return { queue };
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

  approveAll: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const data = await request.formData();
    const cycleIds = data.getAll('cycleId').map((v) => v.toString());
    if (cycleIds.length === 0) return fail(400, { error: 'Nothing selected' });

    try {
      const count = await approvePayoutBatch(
        locals.session.familyId,
        locals.session.personId,
        cycleIds
      );
      return { ok: true, count };
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },

  skipAll: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const data = await request.formData();
    const cycleIds = data.getAll('cycleId').map((v) => v.toString());
    if (cycleIds.length === 0) return fail(400, { error: 'Nothing selected' });

    try {
      const count = await skipPayoutBatch(
        locals.session.familyId,
        locals.session.personId,
        cycleIds
      );
      return { ok: true, count };
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },
};
