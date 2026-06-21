// Runs on every request. Reads the session cookie, attaches Session to locals.

import type { Handle } from '@sveltejs/kit';
import { COOKIE_NAME, loadSessionFromCookie } from '$lib/server/auth';
import { scheduleNightlyBackup } from '$lib/server/backup';
import { ensureSecrets } from '$lib/server/bootstrap';
import { scheduleNightlySummaryPush } from '$lib/server/scoreboard-sync';
import { startMdnsAdvertisement } from '$lib/server/mdns';

// Boot-time work — runs once on first request.
ensureSecrets();
scheduleNightlyBackup();
scheduleNightlySummaryPush();
startMdnsAdvertisement();

export const handle: Handle = async ({ event, resolve }) => {
  const cookie = event.cookies.get(COOKIE_NAME);
  const session = await loadSessionFromCookie(cookie);
  // app.d.ts declares locals.session; cast to any here because Session has more
  // fields than the declared shape — we'll widen the type if needed later.
  event.locals.session = session as any;
  return resolve(event);
};
