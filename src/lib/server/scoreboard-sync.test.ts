import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pushSummaryIfConnected } from './scoreboard-sync';
import { setConfig } from './config';
import { seedFamily, seedKid } from './test/seed';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('pushSummaryIfConnected', () => {
  it('does nothing and returns false when not connected', async () => {
    seedFamily('Solo');
    expect(await pushSummaryIfConnected()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pushes the local family summary when connected', async () => {
    const fam = seedFamily('Smith');
    seedKid(fam, 'Mia');
    await setConfig('scoreboard_url', 'https://sb.test');
    await setConfig('scoreboard_house_id', 'h_1');
    await setConfig('scoreboard_token', 'tok');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    expect(await pushSummaryIfConnected()).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://sb.test/summary');
  });
});
