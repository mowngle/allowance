import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { registerHouse, authedFetch } from './helpers';
import type { Summary } from '../src/types';

const sampleKids = [
  { name: 'Mia', avatar: '🦊', pct: 92, streak: 6, choresDone: 11, badges: ['perfect-week'] },
];

describe('POST /summary', () => {
  it('rejects requests with no/invalid credentials', async () => {
    const { SELF } = await import('cloudflare:test');
    const res = await SELF.fetch('https://sb.test/summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekStarting: '2026-06-01', kids: sampleKids }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a bad token for a real house', async () => {
    const creds = await registerHouse('Smith');
    const res = await authedFetch(
      { ...creds, token: 'deadbeef' },
      '/summary',
      { method: 'POST', body: JSON.stringify({ weekStarting: '2026-06-01', kids: sampleKids }) }
    );
    expect(res.status).toBe(401);
  });

  it('stores the summary for an authenticated house', async () => {
    const creds = await registerHouse('Smith');
    const res = await authedFetch(creds, '/summary', {
      method: 'POST',
      body: JSON.stringify({ weekStarting: '2026-06-01', kids: sampleKids }),
    });
    expect(res.status).toBe(200);
    const stored = (await env.SCOREBOARD.get(`summary:${creds.houseId}`, 'json')) as Summary;
    expect(stored.house).toBe('Smith');
    expect(stored.houseId).toBe(creds.houseId);
    expect(stored.kids[0].name).toBe('Mia');
    expect(typeof stored.updatedAt).toBe('number');
  });

  it('rejects a malformed summary body', async () => {
    const creds = await registerHouse('Smith');
    const res = await authedFetch(creds, '/summary', {
      method: 'POST',
      body: JSON.stringify({ kids: 'nope' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a summary whose kids entries are malformed', async () => {
    const creds = await registerHouse('Smith');
    const res = await authedFetch(creds, '/summary', {
      method: 'POST',
      body: JSON.stringify({ weekStarting: '2026-06-01', kids: [{ name: 'Mia' }, 42] }),
    });
    expect(res.status).toBe(400);
  });
});
