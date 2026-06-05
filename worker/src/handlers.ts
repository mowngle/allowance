import type { Env, House, Summary, SummaryKid, LinkRequest, Cheer } from './types';
import { json, sha256Hex, randomToken, friendCodeFor, putJSON, getJSON } from './lib';
import type { AuthCtx } from './auth';

export async function register(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  if (!body || typeof body.name !== 'string' || body.name.trim() === '') {
    return json({ error: 'name required' }, 400);
  }
  const name = body.name.trim();
  const id = `h_${crypto.randomUUID()}`;
  const token = randomToken();
  const tokenHash = await sha256Hex(token);

  // Allocate a unique friend code (retry on the rare collision).
  let friendCode = '';
  for (let i = 0; i < 10; i++) {
    const candidate = friendCodeFor(name);
    const taken = await env.SCOREBOARD.get(`friendcode:${candidate}`);
    if (!taken) {
      friendCode = candidate;
      break;
    }
  }
  if (!friendCode) return json({ error: 'could not allocate friend code' }, 500);

  const house: House = { id, name, tokenHash, friendCode, createdAt: Date.now() };
  try {
    await Promise.all([
      putJSON(env.SCOREBOARD, `house:${id}`, house),
      env.SCOREBOARD.put(`friendcode:${friendCode}`, id),
      putJSON(env.SCOREBOARD, `links:${id}`, []),
      putJSON(env.SCOREBOARD, `requests:${id}`, []),
    ]);
  } catch {
    return json({ error: 'failed to create house' }, 500);
  }

  return json({ houseId: id, token, friendCode });
}

export async function summary(request: Request, env: Env, ctx: AuthCtx): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { weekStarting?: unknown; kids?: unknown }
    | null;
  if (!body || typeof body.weekStarting !== 'string' || !Array.isArray(body.kids)) {
    return json({ error: 'bad summary' }, 400);
  }
  const kidsValid = (body.kids as unknown[]).every(
    (k) =>
      k !== null &&
      typeof k === 'object' &&
      typeof (k as Record<string, unknown>).name === 'string' &&
      typeof (k as Record<string, unknown>).pct === 'number'
  );
  if (!kidsValid) {
    return json({ error: 'bad summary' }, 400);
  }
  const record: Summary = {
    houseId: ctx.houseId,
    house: ctx.house.name,
    weekStarting: body.weekStarting,
    kids: body.kids as SummaryKid[],
    updatedAt: Date.now(),
  };
  await putJSON(env.SCOREBOARD, `summary:${ctx.houseId}`, record);
  return json({ ok: true });
}

async function addLink(env: Env, a: string, b: string): Promise<void> {
  const key = `links:${a}`;
  const list = (await getJSON<string[]>(env.SCOREBOARD, key)) ?? [];
  if (!list.includes(b)) {
    list.push(b);
    await putJSON(env.SCOREBOARD, key, list);
  }
}

export async function linkRequest(request: Request, env: Env, ctx: AuthCtx): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { friendCode?: unknown } | null;
  if (!body || typeof body.friendCode !== 'string') {
    return json({ error: 'friendCode required' }, 400);
  }
  const targetId = await env.SCOREBOARD.get(`friendcode:${body.friendCode.toUpperCase()}`);
  if (!targetId) return json({ error: 'unknown friend code' }, 404);
  if (targetId === ctx.houseId) return json({ error: 'cannot link to yourself' }, 400);

  const [myLinks, theirLinks] = await Promise.all([
    getJSON<string[]>(env.SCOREBOARD, `links:${ctx.houseId}`),
    getJSON<string[]>(env.SCOREBOARD, `links:${targetId}`),
  ]);
  const alreadyLinked =
    (myLinks ?? []).includes(targetId) || (theirLinks ?? []).includes(ctx.houseId);
  if (alreadyLinked) return json({ error: 'already linked' }, 409);

  const key = `requests:${targetId}`;
  const reqs = (await getJSON<LinkRequest[]>(env.SCOREBOARD, key)) ?? [];
  if (!reqs.some((r) => r.fromHouseId === ctx.houseId)) {
    reqs.push({ fromHouseId: ctx.houseId, fromName: ctx.house.name, ts: Date.now() });
    await putJSON(env.SCOREBOARD, key, reqs);
  }
  return json({ ok: true, pending: true });
}

export async function listRequests(_request: Request, env: Env, ctx: AuthCtx): Promise<Response> {
  const reqs = (await getJSON<LinkRequest[]>(env.SCOREBOARD, `requests:${ctx.houseId}`)) ?? [];
  return json({ requests: reqs });
}

export async function linkApprove(request: Request, env: Env, ctx: AuthCtx): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { fromHouseId?: unknown } | null;
  if (!body || typeof body.fromHouseId !== 'string') {
    return json({ error: 'fromHouseId required' }, 400);
  }
  const key = `requests:${ctx.houseId}`;
  const reqs = (await getJSON<LinkRequest[]>(env.SCOREBOARD, key)) ?? [];
  if (!reqs.some((r) => r.fromHouseId === body.fromHouseId)) {
    return json({ error: 'no such request' }, 404);
  }
  await addLink(env, ctx.houseId, body.fromHouseId);
  await addLink(env, body.fromHouseId, ctx.houseId);
  await putJSON(env.SCOREBOARD, key, reqs.filter((r) => r.fromHouseId !== body.fromHouseId));
  // Now that the two are linked, drop any stale reverse-direction request.
  const reverseKey = `requests:${body.fromHouseId}`;
  const reverseReqs = (await getJSON<LinkRequest[]>(env.SCOREBOARD, reverseKey)) ?? [];
  const pruned = reverseReqs.filter((r) => r.fromHouseId !== ctx.houseId);
  if (pruned.length !== reverseReqs.length) {
    await putJSON(env.SCOREBOARD, reverseKey, pruned);
  }
  return json({ ok: true });
}

export async function linkDecline(request: Request, env: Env, ctx: AuthCtx): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { fromHouseId?: unknown } | null;
  if (!body || typeof body.fromHouseId !== 'string') {
    return json({ error: 'fromHouseId required' }, 400);
  }
  const key = `requests:${ctx.houseId}`;
  const reqs = (await getJSON<LinkRequest[]>(env.SCOREBOARD, key)) ?? [];
  await putJSON(env.SCOREBOARD, key, reqs.filter((r) => r.fromHouseId !== body.fromHouseId));
  return json({ ok: true });
}

async function removeLink(env: Env, a: string, b: string): Promise<void> {
  const key = `links:${a}`;
  const list = (await getJSON<string[]>(env.SCOREBOARD, key)) ?? [];
  await putJSON(env.SCOREBOARD, key, list.filter((x) => x !== b));
}

export async function leave(request: Request, env: Env, ctx: AuthCtx): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { houseId?: unknown } | null;
  if (!body || typeof body.houseId !== 'string') {
    return json({ error: 'houseId required' }, 400);
  }
  // Only touch the other house's key if we're genuinely linked to it — avoids
  // creating junk `links:<stranger>` entries from an arbitrary houseId.
  const myLinks = (await getJSON<string[]>(env.SCOREBOARD, `links:${ctx.houseId}`)) ?? [];
  if (myLinks.includes(body.houseId)) {
    await removeLink(env, ctx.houseId, body.houseId);
    await removeLink(env, body.houseId, ctx.houseId);
  }
  return json({ ok: true });
}

export async function board(_request: Request, env: Env, ctx: AuthCtx): Promise<Response> {
  const links = (await getJSON<string[]>(env.SCOREBOARD, `links:${ctx.houseId}`)) ?? [];
  const ids = [ctx.houseId, ...links];

  const houses: Summary[] = [];
  let cheers: Cheer[] = [];
  for (const id of ids) {
    const s = await getJSON<Summary>(env.SCOREBOARD, `summary:${id}`);
    if (s) houses.push(s);
    const c = (await getJSON<Cheer[]>(env.SCOREBOARD, `cheers:${id}`)) ?? [];
    cheers = cheers.concat(c);
  }
  cheers.sort((x, y) => x.ts - y.ts);
  cheers = cheers.slice(-CHEER_CAP);

  return json({ houses, cheers });
}

const CHEER_CAP = 50;

export async function cheer(request: Request, env: Env, ctx: AuthCtx): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { fromName?: unknown; avatar?: unknown; phraseId?: unknown }
    | null;
  if (!body || typeof body.fromName !== 'string' || typeof body.phraseId !== 'string') {
    return json({ error: 'bad cheer' }, 400);
  }
  const key = `cheers:${ctx.houseId}`;
  const list = (await getJSON<Cheer[]>(env.SCOREBOARD, key)) ?? [];
  list.push({
    fromHouseId: ctx.houseId,
    fromHouse: ctx.house.name,
    fromName: body.fromName,
    avatar: typeof body.avatar === 'string' ? body.avatar : '',
    phraseId: body.phraseId,
    ts: Date.now(),
  });
  await putJSON(env.SCOREBOARD, key, list.slice(-CHEER_CAP));
  return json({ ok: true });
}
