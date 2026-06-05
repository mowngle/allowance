import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { registerHouse, authedFetch } from './helpers';
import type { LinkRequest } from '../src/types';

describe('link lifecycle', () => {
  it('link-request queues a pending request on the target, not a link', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');

    const res = await authedFetch(b, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: a.friendCode }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, pending: true });

    const reqs = (await env.SCOREBOARD.get(`requests:${a.houseId}`, 'json')) as LinkRequest[];
    expect(reqs).toHaveLength(1);
    expect(reqs[0].fromHouseId).toBe(b.houseId);
    expect(reqs[0].fromName).toBe('Bravo');
    expect(await env.SCOREBOARD.get(`links:${a.houseId}`, 'json')).toEqual([]);
    expect(await env.SCOREBOARD.get(`links:${b.houseId}`, 'json')).toEqual([]);
  });

  it('rejects an unknown friend code and self-linking', async () => {
    const a = await registerHouse('Alpha');
    const unknown = await authedFetch(a, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: 'NOPE-9999' }),
    });
    expect(unknown.status).toBe(404);

    const self = await authedFetch(a, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: a.friendCode }),
    });
    expect(self.status).toBe(400);
  });

  it('GET /requests lists pending incoming requests', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');
    await authedFetch(b, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: a.friendCode }),
    });
    const res = await authedFetch(a, '/requests');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requests: LinkRequest[] };
    expect(body.requests[0].fromHouseId).toBe(b.houseId);
  });

  it('approve creates a mutual edge and clears the request', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');
    await authedFetch(b, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: a.friendCode }),
    });
    const res = await authedFetch(a, '/link-approve', {
      method: 'POST',
      body: JSON.stringify({ fromHouseId: b.houseId }),
    });
    expect(res.status).toBe(200);
    expect(await env.SCOREBOARD.get(`links:${a.houseId}`, 'json')).toEqual([b.houseId]);
    expect(await env.SCOREBOARD.get(`links:${b.houseId}`, 'json')).toEqual([a.houseId]);
    expect(await env.SCOREBOARD.get(`requests:${a.houseId}`, 'json')).toEqual([]);
  });

  it('approve with no matching request 404s', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');
    const res = await authedFetch(a, '/link-approve', {
      method: 'POST',
      body: JSON.stringify({ fromHouseId: b.houseId }),
    });
    expect(res.status).toBe(404);
  });

  it('decline drops the request without linking', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');
    await authedFetch(b, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: a.friendCode }),
    });
    const res = await authedFetch(a, '/link-decline', {
      method: 'POST',
      body: JSON.stringify({ fromHouseId: b.houseId }),
    });
    expect(res.status).toBe(200);
    expect(await env.SCOREBOARD.get(`requests:${a.houseId}`, 'json')).toEqual([]);
    expect(await env.SCOREBOARD.get(`links:${a.houseId}`, 'json')).toEqual([]);
  });

  it('link-request is idempotent and refuses an already-linked house', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');
    await authedFetch(b, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: a.friendCode }),
    });
    await authedFetch(b, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: a.friendCode }),
    });
    const reqs = (await env.SCOREBOARD.get(`requests:${a.houseId}`, 'json')) as LinkRequest[];
    expect(reqs).toHaveLength(1);
    await authedFetch(a, '/link-approve', {
      method: 'POST',
      body: JSON.stringify({ fromHouseId: b.houseId }),
    });
    const again = await authedFetch(b, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: a.friendCode }),
    });
    expect(again.status).toBe(409);
  });
});
