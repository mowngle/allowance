// Home page server load. Loads role-appropriate data:
//   - Kid: today's chores + week progress
//   - Parent: kid summaries + pending approvals queue

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import {
  ensureTodaysInstances,
  getTodayChores,
  getWeekProgress,
  markChoreDone,
} from '$lib/server/chores';
import {
  getKidSummaries,
  getPendingApprovals,
  confirmApproval,
  disputeApproval,
  getBalanceCents,
} from '$lib/server/family';
import { requireFreshPin } from '$lib/server/pinGuard';
import { sendToFamilyParents } from '$lib/server/push';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
  const session = locals.session;
  if (!session) throw redirect(303, '/claim');

  if (session.role === 'kid') {
    await ensureTodaysInstances(session.personId);
    const [chores, progress, balanceCents] = await Promise.all([
      getTodayChores(session.personId),
      getWeekProgress(session.personId),
      getBalanceCents(session.personId),
    ]);
    return { chores, progress, balanceCents, kids: null, pending: null };
  }

  // Parent dashboard
  await requireFreshPin(session, '/');
  const [kids, pending] = await Promise.all([
    getKidSummaries(session.familyId),
    getPendingApprovals(session.familyId),
  ]);
  return { chores: null, progress: null, kids, pending };
};

async function notifyChoreDone(familyId: string, kidName: string): Promise<void> {
  try {
    await sendToFamilyParents(familyId, {
      title: 'Chore marked done',
      body: `${kidName} marked a chore done. Tap to review.`,
      url: '/',
      tag: 'chore-done',
    });
  } catch (e) {
    console.error('[notifyChoreDone] failed:', e);
  }
}

export const actions: Actions = {
  markDone: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'kid') {
      return fail(403, { error: 'Not allowed.' });
    }
    const data = await request.formData();
    const instanceId = data.get('instanceId')?.toString();
    if (!instanceId) return fail(400, { error: 'Missing instance.' });

    try {
      await markChoreDone(locals.session.personId, instanceId);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    // Fire-and-forget push to parents.
    void notifyChoreDone(locals.session.familyId, locals.session.personName);
    return { ok: true };
  },

  confirm: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Not allowed.' });
    }
    const data = await request.formData();
    const instanceId = data.get('instanceId')?.toString();
    if (!instanceId) return fail(400, { error: 'Missing instance.' });
    try {
      await confirmApproval(locals.session.personId, instanceId);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { ok: true };
  },

  dispute: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Not allowed.' });
    }
    const data = await request.formData();
    const instanceId = data.get('instanceId')?.toString();
    if (!instanceId) return fail(400, { error: 'Missing instance.' });
    try {
      await disputeApproval(locals.session.personId, instanceId);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { ok: true };
  },
};
