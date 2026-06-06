// /leaderboard — visible to parent and kid. Shows the cross-home league board.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import {
  isConnected,
  pushSummary,
  getBoard,
  postCheer,
} from '$lib/server/scoreboard';
import { canPostCheers } from '$lib/server/cheers';
import { rankedKids, houseCup } from '$lib/leaderboard-view';
import { CHEER_PHRASES, phraseText } from '$lib/cheers';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
  const session = locals.session;
  if (!session) throw redirect(303, '/claim');

  if (!(await isConnected())) {
    return { connected: false as const };
  }

  try {
    await pushSummary(session.familyId);
  } catch (e) {
    console.error('[leaderboard] pushSummary failed (showing last-known):', e);
  }

  let board;
  try {
    board = await getBoard();
  } catch (e) {
    console.error('[leaderboard] getBoard failed:', e);
    return { connected: true as const, unreachable: true as const };
  }

  const ranked = rankedKids(board.houses);
  const cup = houseCup(board.houses);

  const viewerCanCheer = session.role === 'kid' && (await canPostCheers(session.personId));
  let viewerAvatar = '';
  if (viewerCanCheer) {
    const rows = await db
      .select({ avatarUrl: schema.persons.avatarUrl })
      .from(schema.persons)
      .where(eq(schema.persons.id, session.personId))
      .limit(1);
    viewerAvatar = rows[0]?.avatarUrl ?? '';
  }

  const cheers = board.cheers
    .map((c) => ({ ...c, text: phraseText(c.phraseId) ?? c.phraseId }))
    .reverse();

  return {
    connected: true as const,
    unreachable: false as const,
    ranked,
    cup,
    cheers,
    viewerCanCheer,
    viewerName: session.personName,
    viewerAvatar,
    phrases: CHEER_PHRASES,
  };
};

export const actions: Actions = {
  cheer: async ({ locals, request }) => {
    const session = locals.session;
    if (!session || session.role !== 'kid') return fail(403, { error: 'Not allowed.' });
    if (!(await canPostCheers(session.personId))) {
      return fail(403, { error: 'Cheers are turned off for you.' });
    }
    const data = await request.formData();
    const phraseId = data.get('phraseId')?.toString() ?? '';
    if (!phraseText(phraseId)) return fail(400, { error: 'Unknown cheer.' });

    const rows = await db
      .select({ avatarUrl: schema.persons.avatarUrl })
      .from(schema.persons)
      .where(eq(schema.persons.id, session.personId))
      .limit(1);
    try {
      await postCheer({
        fromName: session.personName,
        avatar: rows[0]?.avatarUrl ?? '',
        phraseId,
      });
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { ok: true };
  },

  refresh: async ({ locals }) => {
    const session = locals.session;
    if (!session) return fail(403, { error: 'Not allowed.' });
    if (!(await isConnected())) return fail(400, { error: 'Not connected to a scoreboard.' });
    try {
      await pushSummary(session.familyId);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { ok: true };
  },
};
