// /kid/[id] — parent-only detail page for a single kid.
// Shows balance, full ledger, debit + adjustment forms, and the chores behind
// the kid's "N behind" badge on the dashboard — with the two verbs that clear
// one: credit it (they did do it) or excuse it (it doesn't count).

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { confirmApproval, excuseChore, getBalanceCents } from '$lib/server/family';
import { getCatchUpChores } from '$lib/server/chores';
import { getKidLedger, recordDebit, recordAdjustment } from '$lib/server/ledger';
import { ageOn } from '$lib/server/dates';
import { requireFreshPin } from '$lib/server/pinGuard';

export const load: PageServerLoad = async ({ locals, params }) => {
  const session = locals.session;
  if (!session) throw redirect(303, '/claim');
  if (session.role !== 'parent') throw error(403, 'Parents only');
  await requireFreshPin(session, `/kid/${params.id}`);

  const rows = await db
    .select({
      id: schema.persons.id,
      name: schema.persons.name,
      birthdate: schema.persons.birthdate,
      familyId: schema.persons.familyId,
      role: schema.persons.role,
    })
    .from(schema.persons)
    .where(eq(schema.persons.id, params.id))
    .limit(1);
  const kid = rows[0];
  if (!kid) throw error(404, 'Kid not found');
  if (kid.familyId !== session.familyId) throw error(403, 'Different family');
  if (kid.role !== 'kid') throw error(400, 'Not a kid');

  const today = new Date().toISOString().slice(0, 10);
  const age = kid.birthdate ? ageOn(kid.birthdate, today) : 0;

  const [balanceCents, ledger, catchUp] = await Promise.all([
    getBalanceCents(kid.id),
    getKidLedger(kid.id, { limit: 50 }),
    getCatchUpChores(kid.id),
  ]);

  return {
    kid: { id: kid.id, name: kid.name, age },
    balanceCents,
    ledger,
    catchUp,
  };
};

export const actions: Actions = {
  /** "They did do it" — credits the chore exactly as approving from the queue does. */
  creditChore: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const instanceId = (await request.formData()).get('instanceId')?.toString();
    if (!instanceId) return fail(400, { error: 'Missing instance.' });
    try {
      await confirmApproval(locals.session.personId, instanceId);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { ok: true };
  },

  /** "It doesn't count" — waives the chore; neither done nor missed. */
  excuseChore: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const instanceId = (await request.formData()).get('instanceId')?.toString();
    if (!instanceId) return fail(400, { error: 'Missing instance.' });
    try {
      await excuseChore(locals.session.personId, instanceId);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { ok: true };
  },

  debit: async ({ locals, request, params }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const data = await request.formData();
    const amountStr = data.get('amountDollars')?.toString();
    const description = data.get('description')?.toString() ?? '';
    if (!amountStr) return fail(400, { error: 'Missing amount' });
    const amountCents = Math.round(parseFloat(amountStr) * 100);
    if (Number.isNaN(amountCents) || amountCents <= 0) {
      return fail(400, { error: 'Amount must be positive' });
    }

    try {
      await recordDebit({
        parentPersonId: locals.session.personId,
        kidId: params.id,
        amountCents,
        description,
      });
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { ok: true };
  },

  adjust: async ({ locals, request, params }) => {
    if (!locals.session || locals.session.role !== 'parent') {
      return fail(403, { error: 'Parents only' });
    }
    const data = await request.formData();
    const amountStr = data.get('amountDollars')?.toString();
    const description = data.get('description')?.toString() ?? '';
    const visibleToKid = data.get('visibleToKid') === 'on';
    if (!amountStr) return fail(400, { error: 'Missing amount' });
    const amountCents = Math.round(parseFloat(amountStr) * 100);
    if (Number.isNaN(amountCents) || amountCents === 0) {
      return fail(400, { error: 'Amount must be nonzero' });
    }

    try {
      await recordAdjustment({
        parentPersonId: locals.session.personId,
        kidId: params.id,
        amountCents,
        description,
        visibleToKid,
      });
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { ok: true };
  },
};
