import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { registerHouse, authedFetch } from './helpers';
import type { Cheer } from '../src/types';

describe('POST /cheer', () => {
  it('appends a cheer with worker-stamped house + ts', async () => {
    const a = await registerHouse('Alpha');
    const res = await authedFetch(a, '/cheer', {
      method: 'POST',
      body: JSON.stringify({ fromName: 'Mia', avatar: '🦊', phraseId: 'catch-me' }),
    });
    expect(res.status).toBe(200);
    const list = (await env.SCOREBOARD.get(`cheers:${a.houseId}`, 'json')) as Cheer[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      fromHouseId: a.houseId,
      fromHouse: 'Alpha',
      fromName: 'Mia',
      avatar: '🦊',
      phraseId: 'catch-me',
    });
    expect(typeof list[0].ts).toBe('number');
  });

  it('rejects a cheer missing phraseId or fromName', async () => {
    const a = await registerHouse('Alpha');
    const res = await authedFetch(a, '/cheer', {
      method: 'POST',
      body: JSON.stringify({ fromName: 'Mia' }),
    });
    expect(res.status).toBe(400);
  });

  it('caps the stored feed at 50, keeping the most recent', async () => {
    const a = await registerHouse('Alpha');
    for (let i = 0; i < 55; i++) {
      await authedFetch(a, '/cheer', {
        method: 'POST',
        body: JSON.stringify({ fromName: `K${i}`, avatar: '⭐', phraseId: 'gg' }),
      });
    }
    const list = (await env.SCOREBOARD.get(`cheers:${a.houseId}`, 'json')) as Cheer[];
    expect(list).toHaveLength(50);
    expect(list[0].fromName).toBe('K5');
    expect(list[49].fromName).toBe('K54');
  });
});
