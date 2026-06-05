import type { Env } from './types';
import { json } from './lib';
import { withAuth } from './auth';
import { register, summary, cheer, linkRequest, listRequests, linkApprove, linkDecline, leave, board } from './handlers';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'GET' && path === '/health') return json({ ok: true });
    if (method === 'POST' && path === '/register') return register(request, env);

    if (method === 'POST' && path === '/summary') return withAuth(request, env, summary);
    if (method === 'POST' && path === '/cheer') return withAuth(request, env, cheer);

    if (method === 'GET' && path === '/requests') return withAuth(request, env, listRequests);
    if (method === 'GET' && path === '/board') return withAuth(request, env, board);
    if (method === 'POST' && path === '/link-request') return withAuth(request, env, linkRequest);
    if (method === 'POST' && path === '/link-approve') return withAuth(request, env, linkApprove);
    if (method === 'POST' && path === '/link-decline') return withAuth(request, env, linkDecline);
    if (method === 'POST' && path === '/leave') return withAuth(request, env, leave);

    return json({ error: 'not found' }, 404);
  },
};
