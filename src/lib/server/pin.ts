// Parent PIN: scrypt-hashed, stored on persons.parent_pin_hash.
// "Freshness" = was PIN entered on this device within IDLE_MS.

import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { db, schema } from './db';

const scrypt = promisify(scryptCb);
const N = 16384;
const r = 8;
const p = 1;
const KEY_LEN = 32;

export const PIN_IDLE_MS = 5 * 60 * 1000; // 5 minutes

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(pin.normalize(), salt, KEY_LEN, { N, r, p })) as Buffer;
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPinHash(pin: string, stored: string): Promise<boolean> {
  try {
    const [scheme, nStr, rStr, pStr, saltHex, keyHex] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(keyHex, 'hex');
    const got = (await scrypt(pin.normalize(), salt, expected.length, {
      N: parseInt(nStr, 10),
      r: parseInt(rStr, 10),
      p: parseInt(pStr, 10),
    })) as Buffer;
    return got.length === expected.length && timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}

export async function setParentPin(personId: string, pin: string): Promise<void> {
  if (pin.length < 4) throw new Error('PIN must be at least 4 characters');
  const hash = await hashPin(pin);
  db.update(schema.persons)
    .set({ parentPinHash: hash })
    .where(eq(schema.persons.id, personId))
    .run();
}

export async function clearParentPin(personId: string): Promise<void> {
  db.update(schema.persons)
    .set({ parentPinHash: null })
    .where(eq(schema.persons.id, personId))
    .run();
}

export async function parentHasPin(personId: string): Promise<boolean> {
  const rows = await db
    .select({ hash: schema.persons.parentPinHash })
    .from(schema.persons)
    .where(eq(schema.persons.id, personId))
    .limit(1);
  return !!rows[0]?.parentPinHash;
}

export type PinStatus =
  | { kind: 'no-pin-required' } // person has no PIN set
  | { kind: 'fresh' }            // verified recently
  | { kind: 'stale' };           // PIN exists but device hasn't verified recently

export async function getPinStatus(personId: string, deviceId: string): Promise<PinStatus> {
  const personRows = await db
    .select({ hash: schema.persons.parentPinHash })
    .from(schema.persons)
    .where(eq(schema.persons.id, personId))
    .limit(1);
  if (!personRows[0]?.parentPinHash) return { kind: 'no-pin-required' };

  const deviceRows = await db
    .select({ verifiedAt: schema.devices.parentPinVerifiedAt })
    .from(schema.devices)
    .where(eq(schema.devices.id, deviceId))
    .limit(1);
  const at = deviceRows[0]?.verifiedAt ?? 0;
  if (Date.now() - at < PIN_IDLE_MS) return { kind: 'fresh' };
  return { kind: 'stale' };
}

/**
 * Verify a submitted PIN. On success, stamps the device's parent_pin_verified_at.
 */
export async function verifyAndMarkPin(
  personId: string,
  deviceId: string,
  pin: string
): Promise<boolean> {
  const rows = await db
    .select({ hash: schema.persons.parentPinHash })
    .from(schema.persons)
    .where(eq(schema.persons.id, personId))
    .limit(1);
  const hash = rows[0]?.parentPinHash;
  if (!hash) return false;
  const ok = await verifyPinHash(pin, hash);
  if (ok) {
    db.update(schema.devices)
      .set({ parentPinVerifiedAt: Date.now() })
      .where(eq(schema.devices.id, deviceId))
      .run();
  }
  return ok;
}
