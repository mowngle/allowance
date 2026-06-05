import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { registerHouse } from './helpers';
import type { House } from '../src/types';

describe('POST /register', () => {
  it('creates a house and returns credentials', async () => {
    const creds = await registerHouse('Smith');
    expect(creds.houseId).toMatch(/^h_/);
    expect(creds.token).toMatch(/^[0-9a-f]{64}$/);
    expect(creds.friendCode).toMatch(/^SMITH-[A-Z0-9]{4}$/);
  });

  it('persists the house and a friend-code reverse lookup, storing only a token hash', async () => {
    const creds = await registerHouse('Jones');
    const house = (await env.SCOREBOARD.get(`house:${creds.houseId}`, 'json')) as House;
    expect(house.name).toBe('Jones');
    expect(house.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(house.tokenHash).not.toBe(creds.token);
    const reverse = await env.SCOREBOARD.get(`friendcode:${creds.friendCode}`);
    expect(reverse).toBe(creds.houseId);
    expect(await env.SCOREBOARD.get(`links:${creds.houseId}`, 'json')).toEqual([]);
    expect(await env.SCOREBOARD.get(`requests:${creds.houseId}`, 'json')).toEqual([]);
  });

  it('rejects a missing name', async () => {
    const res = await (await import('cloudflare:test')).SELF.fetch('https://sb.test/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
