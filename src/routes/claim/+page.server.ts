// /claim — lists every person in every family in the DB. Tap one to "become"
// them on this device: server sets the session cookie and redirects to /.
//
// For v0 there's a single family in the DB (created by the seed), so the page
// is functionally "pick a member of the family." A future onboarding flow will
// handle the case where the DB is empty.

import type { Actions, PageServerLoad } from './$types';
import { redirect, fail } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db';
import { claimDevice, COOKIE_NAME } from '$lib/server/auth';

export const load: PageServerLoad = async () => {
  const families = await db
    .select({
      id: schema.families.id,
      name: schema.families.name,
    })
    .from(schema.families);

  const persons = await db
    .select({
      id: schema.persons.id,
      familyId: schema.persons.familyId,
      name: schema.persons.name,
      role: schema.persons.role,
    })
    .from(schema.persons);

  return { families, persons };
};

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const data = await request.formData();
    const personId = data.get('personId')?.toString();
    const deviceName = data.get('deviceName')?.toString()?.trim() || 'Unnamed device';
    const deviceKind = (data.get('deviceKind')?.toString() || 'unknown') as
      | 'phone'
      | 'tablet'
      | 'desktop'
      | 'unknown';

    if (!personId) return fail(400, { error: 'Pick a person.' });

    const { token } = await claimDevice({ personId, deviceName, deviceKind });

    cookies.set(COOKIE_NAME, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      // Local LAN, no HTTPS — Secure cookies wouldn't be sent over plain HTTP.
      // When we add TLS in front (e.g. via Caddy on the Mac mini), flip this on.
      secure: false,
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });

    throw redirect(303, '/');
  },
};
