// Step 4: claim this device as the first parent's device, then redirect home.
// This is a GET-redirect so the form on /setup/kids can navigate here without a POST.

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getOrInitOnlyFamily, getFirstParent } from '$lib/server/setup';
import { claimDevice, COOKIE_NAME } from '$lib/server/auth';

export const load: PageServerLoad = async ({ cookies }) => {
  const fam = await getOrInitOnlyFamily();
  if (!fam) throw redirect(303, '/setup');
  if (!fam.hasParent) throw redirect(303, '/setup/parent');

  const parent = await getFirstParent(fam.id);
  if (!parent) throw redirect(303, '/setup/parent');

  // Auto-claim this device for the first parent.
  const { token } = await claimDevice({
    personId: parent.id,
    deviceName: `${parent.name}'s device`,
    deviceKind: 'unknown',
  });

  cookies.set(COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 60 * 60 * 24 * 365,
  });

  throw redirect(303, '/');
};
