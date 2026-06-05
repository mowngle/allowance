import type { Env, House, Summary, SummaryKid } from './types';
import { json, sha256Hex, randomToken, friendCodeFor, putJSON } from './lib';
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
