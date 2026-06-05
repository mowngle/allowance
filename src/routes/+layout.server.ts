// Global redirect logic:
//   - DB empty → /setup
//   - Setup complete + no session, not on /claim → /claim
//   - Has session + on /claim or /setup → /

import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { isSetupComplete } from '$lib/server/setup';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  const onSetup = url.pathname.startsWith('/setup');
  const onClaim = url.pathname.startsWith('/claim');

  const setupOk = await isSetupComplete();

  if (!setupOk) {
    if (!onSetup) throw redirect(303, '/setup');
    return { session: null };
  }

  // Setup is complete past this point.
  if (onSetup) {
    // Wizard re-visited after install; send home.
    if (locals.session) throw redirect(303, '/');
    throw redirect(303, '/claim');
  }

  if (!locals.session && !onClaim) throw redirect(303, '/claim');
  if (locals.session && onClaim) throw redirect(303, '/');

  return { session: locals.session };
};
