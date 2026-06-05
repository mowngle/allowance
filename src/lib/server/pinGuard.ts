// Call from a sensitive route's load function. If the parent has a PIN and
// the device hasn't verified recently, throws a redirect to /pin?return=...

import { redirect } from '@sveltejs/kit';
import type { Session } from './auth';
import { getPinStatus } from './pin';

export async function requireFreshPin(session: Session | null, returnPath: string): Promise<void> {
  if (!session || session.role !== 'parent') return; // not applicable
  const status = await getPinStatus(session.personId, session.deviceId);
  if (status.kind === 'stale') {
    throw redirect(303, `/pin?return=${encodeURIComponent(returnPath)}`);
  }
}
