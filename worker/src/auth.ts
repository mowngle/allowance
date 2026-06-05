import type { Env, House } from './types';
import { json, sha256Hex, getJSON } from './lib';

export interface AuthCtx {
  houseId: string;
  house: House;
}

/** Returns AuthCtx on success, or a 401 Response on failure. */
export async function authenticate(request: Request, env: Env): Promise<AuthCtx | Response> {
  const houseId = request.headers.get('X-House-Id');
  const authHeader = request.headers.get('Authorization');
  if (!houseId || !authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'unauthorized' }, 401);
  }
  const token = authHeader.slice('Bearer '.length);
  const house = await getJSON<House>(env.SCOREBOARD, `house:${houseId}`);
  if (!house) return json({ error: 'unauthorized' }, 401);
  const presented = await sha256Hex(token);
  if (presented !== house.tokenHash) return json({ error: 'unauthorized' }, 401);
  return { houseId, house };
}

export type AuthedHandler = (request: Request, env: Env, ctx: AuthCtx) => Promise<Response>;

/** Authenticates, then delegates to the handler with the AuthCtx. */
export async function withAuth(
  request: Request,
  env: Env,
  handler: AuthedHandler
): Promise<Response> {
  const result = await authenticate(request, env);
  if (result instanceof Response) return result;
  return handler(request, env, result);
}
