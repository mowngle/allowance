import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerHouse,
  pushSummary,
  getBoard,
  postCheer,
  sendLinkRequest,
  isConnected,
} from './scoreboard';
import { getConfig, setConfig } from './config';
import { seedFamily, seedKid, seedChore, seedInstance } from './test/seed';
import { isoDaysAgo } from './dates';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registerHouse', () => {
  it('POSTs name and stores the returned creds', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ houseId: 'h_1', token: 'tok', friendCode: 'SMITH-AB12' })
    );
    const out = await registerHouse('https://sb.test', 'Smith');
    expect(out.friendCode).toBe('SMITH-AB12');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sb.test/register',
      expect.objectContaining({ method: 'POST' })
    );
    expect(await getConfig('scoreboard_house_id')).toBe('h_1');
    expect(await getConfig('scoreboard_token')).toBe('tok');
    expect(await getConfig('scoreboard_friend_code')).toBe('SMITH-AB12');
    expect(await getConfig('scoreboard_url')).toBe('https://sb.test');
  });

  it('strips a trailing slash from the url', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ houseId: 'h_2', token: 't', friendCode: 'X-1' })
    );
    await registerHouse('https://sb.test/', 'Jones');
    expect(fetchMock.mock.calls[0][0]).toBe('https://sb.test/register');
    expect(await getConfig('scoreboard_url')).toBe('https://sb.test');
  });
});

describe('authenticated calls', () => {
  beforeEach(async () => {
    await setConfig('scoreboard_url', 'https://sb.test');
    await setConfig('scoreboard_house_id', 'h_1');
    await setConfig('scoreboard_token', 'tok');
  });

  it('isConnected reflects stored creds', async () => {
    expect(await isConnected()).toBe(true);
  });

  it('pushSummary builds the local summary and POSTs it with auth headers', async () => {
    const fam = seedFamily('Smith');
    const kid = seedKid(fam, 'Mia');
    const chore = seedChore(fam, kid);
    seedInstance(chore, isoDaysAgo(1), 'confirmed');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await pushSummary(fam);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sb.test/summary');
    expect(init.method).toBe('POST');
    expect(init.headers['X-House-Id']).toBe('h_1');
    expect(init.headers['Authorization']).toBe('Bearer tok');
    const body = JSON.parse(init.body);
    expect(body.house).toBe('Smith');
    expect(body.kids[0].name).toBe('Mia');
  });

  it('getBoard returns the parsed board', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ houses: [{ house: 'Smith' }], cheers: [] }));
    const board = await getBoard();
    expect(board.houses[0].house).toBe('Smith');
  });

  it('postCheer sends the cheer fields', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await postCheer({ fromName: 'Mia', avatar: '🦊', phraseId: 'gg' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sb.test/cheer');
    expect(JSON.parse(init.body)).toEqual({ fromName: 'Mia', avatar: '🦊', phraseId: 'gg' });
  });

  it('sendLinkRequest posts the friend code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, pending: true }));
    await sendLinkRequest('BRAVO-99');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sb.test/link-request');
    expect(JSON.parse(init.body)).toEqual({ friendCode: 'BRAVO-99' });
  });
});

describe('not connected', () => {
  it('getBoard throws when creds are absent', async () => {
    await expect(getBoard()).rejects.toThrow(/not connected/i);
  });
});
