import { describe, it, expect } from 'vitest';
import { getConfig, setConfig, deleteConfig, getScoreboardCreds } from './config';

describe('config', () => {
  it('returns null for an unset key', async () => {
    expect(await getConfig('scoreboard_url')).toBeNull();
  });

  it('sets then gets a value, and upserts on repeat', async () => {
    await setConfig('scoreboard_url', 'https://a.test');
    expect(await getConfig('scoreboard_url')).toBe('https://a.test');
    await setConfig('scoreboard_url', 'https://b.test');
    expect(await getConfig('scoreboard_url')).toBe('https://b.test');
  });

  it('deletes a key', async () => {
    await setConfig('scoreboard_token', 'abc');
    await deleteConfig('scoreboard_token');
    expect(await getConfig('scoreboard_token')).toBeNull();
  });

  it('getScoreboardCreds returns null until url, house id, and token are all set', async () => {
    expect(await getScoreboardCreds()).toBeNull();
    await setConfig('scoreboard_url', 'https://a.test');
    await setConfig('scoreboard_house_id', 'h_1');
    expect(await getScoreboardCreds()).toBeNull();
    await setConfig('scoreboard_token', 'tok');
    expect(await getScoreboardCreds()).toEqual({
      url: 'https://a.test',
      houseId: 'h_1',
      token: 'tok',
    });
  });
});
