// POST /api/push/test — sends a test push to all parent devices in the family.
// Parents only.

import type { RequestHandler } from './$types';
import { sendToFamilyParents } from '$lib/server/push';

export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.session || locals.session.role !== 'parent') {
    return new Response('Parents only', { status: 403 });
  }
  await sendToFamilyParents(locals.session.familyId, {
    title: 'Allowance · test',
    body: 'Push notifications are working on this device.',
    url: '/',
    tag: 'test',
  });
  return new Response('Sent');
};
