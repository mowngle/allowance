// Device-claim auth.
//
// Session model:
//   - Each device that "claims" the app gets a random cookie token.
//   - The hash of that token is stored in devices.cookie_token_hash.
//   - On every request, hooks.server.ts hashes the presented cookie and looks
//     up the device, then loads the associated person.
//   - Sessions never expire on their own; logging out clears the cookie and
//     deletes the device row.
//
// This is fine because the whole app is LAN-only and not exposed publicly.
// If we ever want to expose it remotely we'd add rotation, idle timeout, etc.

import { randomBytes, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from './db';

export const COOKIE_NAME = 'allowance_session';

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type Session = {
  personId: string;
  role: 'parent' | 'kid';
  familyId: string;
  deviceId: string;
  personName: string;
};

export async function loadSessionFromCookie(cookie: string | undefined): Promise<Session | null> {
  if (!cookie) return null;
  const hash = hashToken(cookie);
  const rows = await db
    .select({
      deviceId: schema.devices.id,
      personId: schema.devices.personId,
      familyId: schema.devices.familyId,
      role: schema.persons.role,
      personName: schema.persons.name,
    })
    .from(schema.devices)
    .innerJoin(schema.persons, eq(schema.persons.id, schema.devices.personId))
    .where(eq(schema.devices.cookieTokenHash, hash))
    .limit(1);
  const r = rows[0];
  if (!r) return null;

  // Touch last_seen_at — best-effort, fire and forget.
  db.update(schema.devices)
    .set({ lastSeenAt: Date.now() })
    .where(eq(schema.devices.id, r.deviceId))
    .run();

  return r as Session;
}

export type ClaimDeviceInput = {
  personId: string;
  deviceName: string;
  deviceKind: 'phone' | 'tablet' | 'desktop' | 'unknown';
};

export type ClaimDeviceResult = {
  token: string;
  deviceId: string;
};

export async function claimDevice(input: ClaimDeviceInput): Promise<ClaimDeviceResult> {
  const person = await db
    .select({ id: schema.persons.id, familyId: schema.persons.familyId })
    .from(schema.persons)
    .where(eq(schema.persons.id, input.personId))
    .limit(1);
  const p = person[0];
  if (!p) throw new Error('Person not found');

  const token = generateToken();
  const hash = hashToken(token);
  const deviceId = crypto.randomUUID();
  const now = Date.now();

  db.insert(schema.devices)
    .values({
      id: deviceId,
      familyId: p.familyId,
      personId: p.id,
      name: input.deviceName,
      kind: input.deviceKind,
      firstClaimedAt: now,
      lastSeenAt: now,
      cookieTokenHash: hash,
    })
    .run();

  return { token, deviceId };
}

export async function unclaimDevice(deviceId: string): Promise<void> {
  db.delete(schema.devices).where(eq(schema.devices.id, deviceId)).run();
}
