import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('router', () => {
  it('unknown path returns 404', async () => {
    const res = await SELF.fetch('https://sb.test/nope');
    expect(res.status).toBe(404);
  });

  it('a known path with the wrong method returns 404', async () => {
    const res = await SELF.fetch('https://sb.test/summary'); // GET on a POST-only route
    expect(res.status).toBe(404);
  });
});
