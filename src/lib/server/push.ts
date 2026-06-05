// Web push for parent phones.
//
// Uses the `web-push` package (Node-compatible, unlike the Cloudflare spike
// which hand-rolled VAPID JWT). Handles payload encryption automatically.
//
// VAPID keys come from .env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT).
// Generate once with: npx web-push generate-vapid-keys

import webpush from 'web-push';
import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db, schema } from './db';

let vapidConfigured = false;
function configure(): boolean {
  if (vapidConfigured) return true;
  const pub = env.VAPID_PUBLIC_KEY;
  const priv = env.VAPID_PRIVATE_KEY;
  const sub = env.VAPID_SUBJECT;
  if (!pub || !priv || !sub) return false;
  webpush.setVapidDetails(sub, pub, priv);
  vapidConfigured = true;
  return true;
}

export function vapidPublicKey(): string | null {
  return env.VAPID_PUBLIC_KEY ?? null;
}

export type SaveSubscriptionInput = {
  deviceId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function saveSubscription(input: SaveSubscriptionInput): Promise<void> {
  // Replace any existing subscription for this device.
  db.delete(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.deviceId, input.deviceId))
    .run();
  db.insert(schema.pushSubscriptions)
    .values({
      id: crypto.randomUUID(),
      deviceId: input.deviceId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      createdAt: Date.now(),
    })
    .run();
}

export async function deleteSubscriptionByEndpoint(endpoint: string): Promise<void> {
  db.delete(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.endpoint, endpoint))
    .run();
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string; // where notificationclick should navigate
  tag?: string; // notification group / dedup
};

export async function sendToFamilyParents(familyId: string, payload: PushPayload): Promise<void> {
  if (!configure()) {
    console.warn('[push] VAPID keys not configured, skipping send.');
    return;
  }

  const subs = await db
    .select({
      id: schema.pushSubscriptions.id,
      endpoint: schema.pushSubscriptions.endpoint,
      p256dh: schema.pushSubscriptions.p256dh,
      auth: schema.pushSubscriptions.auth,
    })
    .from(schema.pushSubscriptions)
    .innerJoin(schema.devices, eq(schema.devices.id, schema.pushSubscriptions.deviceId))
    .innerJoin(schema.persons, eq(schema.persons.id, schema.devices.personId))
    .where(and(eq(schema.persons.familyId, familyId), eq(schema.persons.role, 'parent')));

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          JSON.stringify(payload),
          { TTL: 60 }
        );
      } catch (e: any) {
        // 404/410 means subscription expired — clean it up.
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          db.delete(schema.pushSubscriptions)
            .where(eq(schema.pushSubscriptions.id, s.id))
            .run();
        } else {
          console.error('[push] send failed:', e?.statusCode, e?.body);
        }
      }
    })
  );
}
