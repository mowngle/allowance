// GET /api/push/vapid-key — returns the public VAPID key so the client can subscribe.

import type { RequestHandler } from './$types';
import { vapidPublicKey } from '$lib/server/push';

export const GET: RequestHandler = async () => {
  const key = vapidPublicKey();
  if (!key) {
    return new Response(JSON.stringify({ error: 'VAPID not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ key }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
