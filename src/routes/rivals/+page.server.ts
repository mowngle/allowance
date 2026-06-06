// /rivals — parent-only, PIN-gated. Connect to a scoreboard, manage rivalries,
// and set per-kid cheer permissions.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import { requireFreshPin } from '$lib/server/pinGuard';
import {
  isConnected,
  registerHouse,
  getOwnFriendCode,
  getBoard,
  listRequests,
  sendLinkRequest,
  approveLink,
  declineLink,
  leaveRival,
} from '$lib/server/scoreboard';
import { listKidCheerPerms, setKidCheerPerm } from '$lib/server/cheers';
import { getConfig } from '$lib/server/config';

export const load: PageServerLoad = async ({ locals }) => {
  const session = locals.session;
  if (!session) throw redirect(303, '/claim');
  if (session.role !== 'parent') throw error(403, 'Parents only');
  await requireFreshPin(session, '/rivals');

  const connected = await isConnected();
  const kidPerms = await listKidCheerPerms(session.familyId);

  if (!connected) {
    return { connected: false as const, kidPerms };
  }

  const [friendCode, houseName] = await Promise.all([
    getOwnFriendCode(),
    getConfig('scoreboard_house_name'),
  ]);

  let requests: Array<{ fromHouseId: string; fromName: string; ts: number }> = [];
  let rivals: Array<{ houseId: string; house: string }> = [];
  const ownHouseId = await getConfig('scoreboard_house_id');
  try {
    requests = await listRequests();
    const board = await getBoard();
    rivals = board.houses
      .filter((h) => h.houseId !== ownHouseId)
      .map((h) => ({ houseId: h.houseId, house: h.house }));
  } catch (e) {
    console.error('[rivals] scoreboard read failed:', e);
  }

  return {
    connected: true as const,
    friendCode,
    houseName,
    requests,
    rivals,
    kidPerms,
  };
};

function requireParent(locals: App.Locals) {
  if (!locals.session || locals.session.role !== 'parent') {
    return fail(403, { error: 'Parents only' });
  }
  return null;
}

export const actions: Actions = {
  connect: async ({ locals, request }) => {
    const bad = requireParent(locals);
    if (bad) return bad;
    const data = await request.formData();
    const url = data.get('url')?.toString().trim() ?? '';
    const name = data.get('houseName')?.toString().trim() ?? '';
    if (!url || !name) return fail(400, { error: 'URL and house name are required.' });
    try {
      const out = await registerHouse(url, name);
      return { ok: true, message: `Connected. Your friend code is ${out.friendCode}.` };
    } catch (e) {
      return fail(400, { error: `Could not connect: ${(e as Error).message}` });
    }
  },

  request: async ({ locals, request }) => {
    const bad = requireParent(locals);
    if (bad) return bad;
    const code = (await request.formData()).get('friendCode')?.toString().trim() ?? '';
    if (!code) return fail(400, { error: 'Enter a friend code.' });
    try {
      await sendLinkRequest(code);
      return { ok: true, message: 'Request sent. They need to approve it.' };
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },

  approve: async ({ locals, request }) => {
    const bad = requireParent(locals);
    if (bad) return bad;
    const id = (await request.formData()).get('fromHouseId')?.toString() ?? '';
    if (!id) return fail(400, { error: 'Missing house.' });
    try {
      await approveLink(id);
      return { ok: true, message: 'Linked!' };
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },

  decline: async ({ locals, request }) => {
    const bad = requireParent(locals);
    if (bad) return bad;
    const id = (await request.formData()).get('fromHouseId')?.toString() ?? '';
    if (!id) return fail(400, { error: 'Missing house.' });
    try {
      await declineLink(id);
      return { ok: true };
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },

  leave: async ({ locals, request }) => {
    const bad = requireParent(locals);
    if (bad) return bad;
    const id = (await request.formData()).get('houseId')?.toString() ?? '';
    if (!id) return fail(400, { error: 'Missing house.' });
    try {
      await leaveRival(id);
      return { ok: true, message: 'Rivalry ended.' };
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },

  setCheer: async ({ locals, request }) => {
    const bad = requireParent(locals);
    if (bad) return bad;
    const data = await request.formData();
    const kidId = data.get('kidId')?.toString() ?? '';
    const allowed = data.get('allowed')?.toString() === 'on';
    if (!kidId) return fail(400, { error: 'Missing kid.' });
    await setKidCheerPerm(kidId, allowed);
    return { ok: true };
  },
};
