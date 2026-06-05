import type { Env } from './types';
import { json } from './lib';
import { withAuth } from './auth';
import { register, summary } from './handlers';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'GET' && path === '/health') return json({ ok: true });
    if (method === 'POST' && path === '/register') return register(request, env);

    if (method === 'POST' && path === '/summary') return withAuth(request, env, summary);

    return json({ error: 'not found' }, 404);
  },
};
