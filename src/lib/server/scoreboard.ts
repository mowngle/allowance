// HTTP client for the cross-home Scoreboard Worker. Authenticated calls read the
// connection creds from app_config; registerHouse is the one unauthenticated call
// and persists the creds it receives.

import { getConfig, setConfig, getScoreboardCreds, type ScoreboardCreds } from './config';
import { buildLocalSummary } from './leaderboard';

export type Board = {
  houses: Array<{
    houseId: string;
    house: string;
    weekStarting: string;
    kids: Array<{
      name: string;
      avatar: string;
      pct: number;
      streak: number;
      choresDone: number;
      badges: string[];
    }>;
    updatedAt: number;
  }>;
  cheers: Array<{
    fromHouseId: string;
    fromHouse: string;
    fromName: string;
    avatar: string;
    phraseId: string;
    ts: number;
  }>;
};

export type PendingRequest = { fromHouseId: string; fromName: string; ts: number };

async function creds(): Promise<ScoreboardCreds> {
  const c = await getScoreboardCreds();
  if (!c) throw new Error('Scoreboard not connected');
  return c;
}

async function authed(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown
): Promise<unknown> {
  const c = await creds();
  const res = await fetch(`${c.url}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'X-House-Id': c.houseId,
      Authorization: `Bearer ${c.token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new Error(`Scoreboard ${method} ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function isConnected(): Promise<boolean> {
  return (await getScoreboardCreds()) !== null;
}

/** Register this house with a scoreboard at `url`; stores the returned creds. */
export async function registerHouse(
  url: string,
  name: string
): Promise<{ houseId: string; friendCode: string }> {
  const base = url.replace(/\/+$/, '');
  const res = await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Register failed: ${res.status}`);
  const data = (await res.json()) as { houseId: string; token: string; friendCode: string };
  await Promise.all([
    setConfig('scoreboard_url', base),
    setConfig('scoreboard_house_id', data.houseId),
    setConfig('scoreboard_token', data.token),
    setConfig('scoreboard_friend_code', data.friendCode),
    setConfig('scoreboard_house_name', name),
  ]);
  return { houseId: data.houseId, friendCode: data.friendCode };
}

/** Build this family's summary and push it up. */
export async function pushSummary(familyId: string): Promise<void> {
  const summary = await buildLocalSummary(familyId);
  await authed('/summary', 'POST', summary);
}

export async function getBoard(): Promise<Board> {
  return (await authed('/board', 'GET')) as Board;
}

export async function postCheer(cheer: {
  fromName: string;
  avatar: string;
  phraseId: string;
}): Promise<void> {
  await authed('/cheer', 'POST', cheer);
}

export async function listRequests(): Promise<PendingRequest[]> {
  const out = (await authed('/requests', 'GET')) as { requests: PendingRequest[] };
  return out.requests;
}

export async function sendLinkRequest(friendCode: string): Promise<void> {
  await authed('/link-request', 'POST', { friendCode });
}

export async function approveLink(fromHouseId: string): Promise<void> {
  await authed('/link-approve', 'POST', { fromHouseId });
}

export async function declineLink(fromHouseId: string): Promise<void> {
  await authed('/link-decline', 'POST', { fromHouseId });
}

export async function leaveRival(houseId: string): Promise<void> {
  await authed('/leave', 'POST', { houseId });
}

/** Convenience for the UI: this house's own friend code (or null). */
export async function getOwnFriendCode(): Promise<string | null> {
  return getConfig('scoreboard_friend_code');
}
