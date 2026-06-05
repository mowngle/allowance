import type { Env, House, Summary, SummaryKid, LinkRequest } from './types';
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

  const links = (await getJSON<string[]>(env.SCOREBOARD, `links:${ctx.houseId}`)) ?? [];
  if (links.includes(targetId)) return json({ error: 'already linked' }, 409);

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
