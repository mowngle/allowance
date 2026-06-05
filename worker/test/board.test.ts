import { describe, it, expect } from 'vitest';
import { registerHouse, authedFetch, type Creds } from './helpers';
import type { Summary, Cheer } from '../src/types';

async function postSummary(creds: Creds, kidName: string, pct: number) {
  await authedFetch(creds, '/summary', {
    method: 'POST',
    body: JSON.stringify({
      weekStarting: '2026-06-01',
      kids: [{ name: kidName, avatar: '🦊', pct, streak: 1, choresDone: 3, badges: [] }],
    }),
  });
}

async function link(a: Creds, b: Creds) {
  await authedFetch(b, '/link-request', {
    method: 'POST',
    body: JSON.stringify({ friendCode: a.friendCode }),
  });
  await authedFetch(a, '/link-approve', {
    method: 'POST',
    body: JSON.stringify({ fromHouseId: b.houseId }),
  });
}

describe('GET /board', () => {
  it('returns only the caller plus linked houses (non-transitive)', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');
    const c = await registerHouse('Charlie');
    await postSummary(a, 'Amy', 90);
    await postSummary(b, 'Ben', 80);
    await postSummary(c, 'Cal', 70);
    await link(a, b);
    await link(a, c);

    const aBoard = (await (await authedFetch(a, '/board')).json()) as { houses: Summary[] };
    const aHouses = aBoard.houses.map((h) => h.house).sort();
    expect(aHouses).toEqual(['Alpha', 'Bravo', 'Charlie']);

    const bBoard = (await (await authedFetch(b, '/board')).json()) as { houses: Summary[] };
    const bHouses = bBoard.houses.map((h) => h.house).sort();
    expect(bHouses).toEqual(['Alpha', 'Bravo']);
  });

  it('merges and time-sorts cheers across the league', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');
    await postSummary(a, 'Amy', 90);
    await postSummary(b, 'Ben', 80);
    await link(a, b);
    await authedFetch(a, '/cheer', {
      method: 'POST',
      body: JSON.stringify({ fromName: 'Amy', avatar: '🦊', phraseId: 'gg' }),
    });
    await authedFetch(b, '/cheer', {
      method: 'POST',
      body: JSON.stringify({ fromName: 'Ben', avatar: '🐻', phraseId: 'catch-me' }),
    });
    const board = (await (await authedFetch(a, '/board')).json()) as { cheers: Cheer[] };
    expect(board.cheers).toHaveLength(2);
    expect(board.cheers[0].ts).toBeLessThanOrEqual(board.cheers[1].ts);
  });

  it('a lone house sees only itself', async () => {
    const a = await registerHouse('Solo');
    await postSummary(a, 'Sam', 100);
    const board = (await (await authedFetch(a, '/board')).json()) as { houses: Summary[] };
    expect(board.houses.map((h) => h.house)).toEqual(['Solo']);
  });

  it('stops showing a rival after /leave', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');
    await postSummary(a, 'Amy', 90);
    await postSummary(b, 'Ben', 80);
    await link(a, b);

    let aBoard = (await (await authedFetch(a, '/board')).json()) as { houses: Summary[] };
    expect(aBoard.houses.map((h) => h.house).sort()).toEqual(['Alpha', 'Bravo']);

    await authedFetch(a, '/leave', {
      method: 'POST',
      body: JSON.stringify({ houseId: b.houseId }),
    });

    aBoard = (await (await authedFetch(a, '/board')).json()) as { houses: Summary[] };
    expect(aBoard.houses.map((h) => h.house)).toEqual(['Alpha']);
    const bBoard = (await (await authedFetch(b, '/board')).json()) as { houses: Summary[] };
    expect(bBoard.houses.map((h) => h.house)).toEqual(['Bravo']);
  });
});
