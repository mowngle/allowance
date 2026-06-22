// /settings/payouts — parent-only, PIN-gated. Set the family payout scheme + per-kid overrides.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireFreshPin } from '$lib/server/pinGuard';
import { db, schema } from '$lib/server/db';
import { dollarsToCents, centsToDollars, parseOverride } from '$lib/server/payout-config';
import { saveFamilyDefault, saveKidOverride, clearKidOverride } from '$lib/server/payout-settings';
import type { PayoutMode } from '$lib/server/payout-config';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.session) throw redirect(303, '/claim');
  if (locals.session.role !== 'parent') throw error(403, 'Parents only');
  await requireFreshPin(locals.session, '/settings/payouts');

  const fam = (await db
    .select({
      mode: schema.families.payoutMode,
      cpy: schema.families.payoutCentsPerYear,
      bonus: schema.families.payoutBonusCents,
      fixed: schema.families.payoutFixedCents,
    })
    .from(schema.families)
    .where(eq(schema.families.id, locals.session.familyId))
    .limit(1))[0];
  if (!fam) throw error(404, 'Family not found');

  const kidRows = await db
    .select({ id: schema.persons.id, name: schema.persons.name, override: schema.persons.payoutOverride })
    .from(schema.persons)
    .where(and(eq(schema.persons.familyId, locals.session.familyId), eq(schema.persons.role, 'kid'), eq(schema.persons.active, true)));

  return {
    family: {
      mode: fam.mode,
      rate: centsToDollars(fam.cpy),
      bonus: centsToDollars(fam.bonus),
      fixed: centsToDollars(fam.fixed),
    },
    kids: kidRows.map((k) => {
      const o = parseOverride(k.override);
      return {
        id: k.id,
        name: k.name,
        hasOverride: o !== null,
        mode: o?.mode ?? ('age' as PayoutMode),
        rate: centsToDollars(o?.centsPerYear ?? 100),
        bonus: centsToDollars(o?.bonusCents ?? 0),
        fixed: centsToDollars(o?.fixedCents ?? 0),
      };
    }),
  };
};

function parseScheme(d: FormData): { mode: PayoutMode; rate: number; bonus: number; fixed: number } | null {
  const mode = d.get('mode')?.toString();
  if (mode !== 'age' && mode !== 'fixed') return null;
  const rate = dollarsToCents(d.get('rate')?.toString() ?? '0');
  const bonus = dollarsToCents(d.get('bonus')?.toString() ?? '0');
  const fixed = dollarsToCents(d.get('fixed')?.toString() ?? '0');
  if (rate === null || bonus === null || fixed === null) return null;
  return { mode, rate, bonus, fixed };
}

export const actions: Actions = {
  saveFamily: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') return fail(403, { error: 'Parents only' });
    const s = parseScheme(await request.formData());
    if (!s) return fail(400, { error: 'Amounts must be non-negative numbers.' });
    await saveFamilyDefault(locals.session.familyId, {
      mode: s.mode,
      rateCents: s.rate,
      bonusCents: s.bonus,
      fixedCents: s.fixed,
    });
    return { ok: true, message: 'Family default saved.' };
  },

  saveKid: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') return fail(403, { error: 'Parents only' });
    const d = await request.formData();
    const kidId = d.get('kidId')?.toString() ?? '';
    const s = parseScheme(d);
    if (!kidId || !s) return fail(400, { error: 'Amounts must be non-negative numbers.' });
    await saveKidOverride(locals.session.familyId, kidId, {
      mode: s.mode,
      centsPerYear: s.rate,
      bonusCents: s.bonus,
      fixedCents: s.fixed,
    });
    return { ok: true, message: 'Override saved.' };
  },

  clearKid: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') return fail(403, { error: 'Parents only' });
    const kidId = (await request.formData()).get('kidId')?.toString() ?? '';
    if (!kidId) return fail(400, { error: 'Missing kid.' });
    await clearKidOverride(locals.session.familyId, kidId);
    return { ok: true, message: 'Reverted to family default.' };
  },
};
