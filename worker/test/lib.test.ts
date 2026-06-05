import { describe, it, expect } from 'vitest';
import { sha256Hex, randomToken, friendCodeFor, json } from '../src/lib';

describe('lib helpers', () => {
  it('sha256Hex is deterministic 64-char hex', async () => {
    const a = await sha256Hex('hello');
    const b = await sha256Hex('hello');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex('world')).not.toBe(a);
  });

  it('randomToken is 64-char hex and unique', () => {
    const t1 = randomToken();
    const t2 = randomToken();
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t1).not.toBe(t2);
  });

  it('friendCodeFor uses an uppercase name slug and avoids ambiguous chars', () => {
    const code = friendCodeFor('Smith Family!');
    expect(code).toMatch(/^SMITH-[A-Z0-9]{4}$/);
    expect(code.split('-')[1]).not.toMatch(/[IO01]/);
  });

  it('friendCodeFor falls back to FAM for empty slugs', () => {
    expect(friendCodeFor('123')).toMatch(/^FAM-[A-Z0-9]{4}$/);
  });

  it('json() builds a JSON Response with status', async () => {
    const res = json({ a: 1 }, 418);
    expect(res.status).toBe(418);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ a: 1 });
  });
});
