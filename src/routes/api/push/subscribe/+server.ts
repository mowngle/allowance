// POST /api/push/subscribe — save the device's PushSubscription.
// Parents only (kid Fire tablets use the wrapper APK's local AlarmManager).

import type { RequestHandler } from './$types';
import { saveSubscription } from '$lib/server/push';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.session || locals.session.role !== 'parent') {
    return new Response('Parents only', { status: 403 });
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
    return new Response('Missing subscription fields', { status: 400 });
  }
  await saveSubscription({
    deviceId: locals.session.deviceId,
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
  });
  return new Response('OK');
};
