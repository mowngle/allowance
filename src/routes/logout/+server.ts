// POST /logout — clears the session cookie and deletes the device row.

import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { COOKIE_NAME, unclaimDevice } from '$lib/server/auth';

export const POST: RequestHandler = async ({ cookies, locals }) => {
  if (locals.session) {
    await unclaimDevice(locals.session.deviceId);
  }
  cookies.delete(COOKIE_NAME, { path: '/' });
  throw redirect(303, '/claim');
};
