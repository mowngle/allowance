import type { Env, House } from './types';
import { json, sha256Hex, randomToken, friendCodeFor, putJSON } from './lib';

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
  await putJSON(env.SCOREBOARD, `house:${id}`, house);
  await env.SCOREBOARD.put(`friendcode:${friendCode}`, id);
  await putJSON(env.SCOREBOARD, `links:${id}`, []);
  await putJSON(env.SCOREBOARD, `requests:${id}`, []);

  return json({ houseId: id, token, friendCode });
}
