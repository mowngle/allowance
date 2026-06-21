import { describe, it, expect } from 'vitest';
import {
  computeSuggestedCents,
  parseOverride,
  resolvePayoutConfig,
  familyDefault,
  dollarsToCents,
  centsToDollars,
  type PayoutConfig,
  type FamilyPayoutColumns,
} from './payout-config';

const fam: FamilyPayoutColumns = {
  payoutMode: 'age',
  payoutCentsPerYear: 100,
  payoutBonusCents: 0,
  payoutFixedCents: 0,
};

describe('computeSuggestedCents', () => {
  it('age mode = age × rate + bonus', () => {
    const cfg: PayoutConfig = { mode: 'age', centsPerYear: 150, bonusCents: 200, fixedCents: 0 };
    expect(computeSuggestedCents(cfg, 8)).toBe(8 * 150 + 200); // 1400
  });
  it('fixed mode ignores age', () => {
    const cfg: PayoutConfig = { mode: 'fixed', centsPerYear: 0, bonusCents: 0, fixedCents: 1500 };
    expect(computeSuggestedCents(cfg, 14)).toBe(1500);
  });
  it('clamps negative age to 0 (still adds bonus)', () => {
    const cfg: PayoutConfig = { mode: 'age', centsPerYear: 100, bonusCents: 50, fixedCents: 0 };
    expect(computeSuggestedCents(cfg, -3)).toBe(50);
  });
  it('age 0 = bonus only', () => {
    const cfg: PayoutConfig = { mode: 'age', centsPerYear: 100, bonusCents: 0, fixedCents: 0 };
    expect(computeSuggestedCents(cfg, 0)).toBe(0);
  });
});

describe('parseOverride', () => {
  it('returns null for null/empty', () => {
    expect(parseOverride(null)).toBeNull();
    expect(parseOverride('')).toBeNull();
  });
  it('returns null for malformed JSON or wrong shape', () => {
    expect(parseOverride('not json')).toBeNull();
    expect(parseOverride('{"mode":"weird"}')).toBeNull();
    expect(parseOverride('{"mode":"fixed"}')).toBeNull(); // missing numbers
  });
  it('parses a valid override', () => {
    const o = parseOverride('{"mode":"fixed","centsPerYear":0,"bonusCents":0,"fixedCents":1500}');
    expect(o).toEqual({ mode: 'fixed', centsPerYear: 0, bonusCents: 0, fixedCents: 1500 });
  });
});

describe('resolvePayoutConfig', () => {
  it('uses the override when present', () => {
    const cfg = resolvePayoutConfig(fam, '{"mode":"fixed","centsPerYear":0,"bonusCents":0,"fixedCents":900}');
    expect(cfg.mode).toBe('fixed');
    expect(cfg.fixedCents).toBe(900);
  });
  it('falls back to family default when override is null or malformed', () => {
    expect(resolvePayoutConfig(fam, null)).toEqual(familyDefault(fam));
    expect(resolvePayoutConfig(fam, 'garbage')).toEqual(familyDefault(fam));
  });
});

describe('dollars <-> cents', () => {
  it('parses valid dollar strings', () => {
    expect(dollarsToCents('1')).toBe(100);
    expect(dollarsToCents('1.5')).toBe(150);
    expect(dollarsToCents('0.99')).toBe(99);
    expect(dollarsToCents(' 10 ')).toBe(1000);
  });
  it('rejects negatives, junk, and >2 decimals', () => {
    expect(dollarsToCents('-1')).toBeNull();
    expect(dollarsToCents('abc')).toBeNull();
    expect(dollarsToCents('1.234')).toBeNull();
    expect(dollarsToCents('')).toBeNull();
  });
  it('formats cents to dollars', () => {
    expect(centsToDollars(150)).toBe('1.50');
    expect(centsToDollars(0)).toBe('0.00');
  });
});
