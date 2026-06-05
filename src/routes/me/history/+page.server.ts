// /me/history — kid's own ledger view (visible_to_kid filter applied).

import type { PageServerLoad } from './$types';
import { redirect, error } from '@sveltejs/kit';
import { getKidLedger } from '$lib/server/ledger';
import { getBalanceCents } from '$lib/server/family';

export const load: PageServerLoad = async ({ locals }) => {
  const session = locals.session;
  if (!session) throw redirect(303, '/claim');
  if (session.role !== 'kid') throw error(403, 'Kids only');

  const [balanceCents, ledger] = await Promise.all([
    getBalanceCents(session.personId),
    getKidLedger(session.personId, { onlyVisibleToKid: true, limit: 100 }),
  ]);

  return { balanceCents, ledger };
};
