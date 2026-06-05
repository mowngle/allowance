// First-boot self-bootstrap of secrets.
//
// On boot, if `.env` exists and contains empty/missing VAPID_* or SESSION_SECRET
// values, we generate them and write the file. Subsequent boots see the values
// already present and do nothing.
//
// This makes the app self-contained: any new install (Docker, fresh clone,
// friend's hardware) gets unique secrets without the operator running scripts.
//
// In Docker, .env should be inside a mounted volume so the generated secrets
// persist across container restarts.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import webpush from 'web-push';

const ENV_PATH = resolve('.env');

type EnvMap = Map<string, string>;

function parseEnv(content: string): EnvMap {
  const m: EnvMap = new Map();
  for (const lineRaw of content.split(/\r?\n/)) {
    const line = lineRaw.trimStart();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    m.set(k, v);
  }
  return m;
}

function serializeEnv(content: string, additions: Record<string, string>): string {
  // Preserve existing lines, only filling in keys that are blank or absent.
  const lines = content.split(/\r?\n/);
  const present = new Set<string>();

  const out = lines.map((lineRaw) => {
    const trimmed = lineRaw.trimStart();
    if (!trimmed || trimmed.startsWith('#')) return lineRaw;
    const eq = trimmed.indexOf('=');
    if (eq < 0) return lineRaw;
    const k = trimmed.slice(0, eq).trim();
    present.add(k);
    if (additions[k] !== undefined) {
      const v = trimmed.slice(eq + 1).trim();
      if (v === '' || v === '""' || v === "''") {
        return `${k}=${additions[k]}`;
      }
    }
    return lineRaw;
  });

  // Append any additions that weren't present at all.
  const appended: string[] = [];
  for (const [k, v] of Object.entries(additions)) {
    if (!present.has(k)) appended.push(`${k}=${v}`);
  }
  if (appended.length > 0) {
    if (out[out.length - 1] !== '') out.push('');
    out.push('# Auto-generated on first boot');
    out.push(...appended);
  }
  return out.join('\n');
}

/**
 * Ensure .env has values for VAPID_* and SESSION_SECRET. Writes the file if
 * generation occurred. Safe to call multiple times.
 */
export function ensureSecrets(): void {
  // If no .env exists at all, create one from scratch.
  let content = '';
  if (existsSync(ENV_PATH)) {
    try {
      content = readFileSync(ENV_PATH, 'utf8');
    } catch (e) {
      console.error('[bootstrap] could not read .env:', e);
      return;
    }
  }

  const parsed = parseEnv(content);
  const need: string[] = [];
  for (const k of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'SESSION_SECRET']) {
    const v = parsed.get(k);
    if (!v) need.push(k);
  }
  if (need.length === 0) return;

  const additions: Record<string, string> = {};

  if (need.includes('VAPID_PUBLIC_KEY') || need.includes('VAPID_PRIVATE_KEY')) {
    const vapid = webpush.generateVAPIDKeys();
    if (!parsed.get('VAPID_PUBLIC_KEY')) additions.VAPID_PUBLIC_KEY = vapid.publicKey;
    if (!parsed.get('VAPID_PRIVATE_KEY')) additions.VAPID_PRIVATE_KEY = vapid.privateKey;
    // Also inject into process.env immediately so the current process can use them.
    if (additions.VAPID_PUBLIC_KEY) process.env.VAPID_PUBLIC_KEY = additions.VAPID_PUBLIC_KEY;
    if (additions.VAPID_PRIVATE_KEY) process.env.VAPID_PRIVATE_KEY = additions.VAPID_PRIVATE_KEY;
  }
  if (need.includes('VAPID_SUBJECT')) {
    additions.VAPID_SUBJECT = 'mailto:admin@localhost';
    process.env.VAPID_SUBJECT = additions.VAPID_SUBJECT;
  }
  if (need.includes('SESSION_SECRET')) {
    additions.SESSION_SECRET = randomBytes(32).toString('base64url');
    process.env.SESSION_SECRET = additions.SESSION_SECRET;
  }

  const newContent = serializeEnv(content, additions);
  try {
    writeFileSync(ENV_PATH, newContent, { encoding: 'utf8', mode: 0o600 });
    console.log(`[bootstrap] generated ${Object.keys(additions).join(', ')} into .env`);
  } catch (e) {
    console.error('[bootstrap] could not write .env:', e);
  }
}
