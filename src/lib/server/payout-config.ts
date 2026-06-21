// Pure payout-scheme resolution + computation. No DB, no SvelteKit — unit-testable.

export type PayoutMode = 'age' | 'fixed';

export interface PayoutConfig {
  mode: PayoutMode;
  centsPerYear: number;
  bonusCents: number;
  fixedCents: number;
}

export interface FamilyPayoutColumns {
  payoutMode: PayoutMode;
  payoutCentsPerYear: number;
  payoutBonusCents: number;
  payoutFixedCents: number;
}

export function familyDefault(f: FamilyPayoutColumns): PayoutConfig {
  return {
    mode: f.payoutMode,
    centsPerYear: f.payoutCentsPerYear,
    bonusCents: f.payoutBonusCents,
    fixedCents: f.payoutFixedCents,
  };
}

/** Parse a kid's override JSON into a PayoutConfig, or null if absent/malformed. */
export function parseOverride(json: string | null): PayoutConfig | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (
      o &&
      (o.mode === 'age' || o.mode === 'fixed') &&
      typeof o.centsPerYear === 'number' &&
      typeof o.bonusCents === 'number' &&
      typeof o.fixedCents === 'number'
    ) {
      return {
        mode: o.mode,
        centsPerYear: o.centsPerYear,
        bonusCents: o.bonusCents,
        fixedCents: o.fixedCents,
      };
    }
  } catch {
    /* fall through to null */
  }
  return null;
}

export function resolvePayoutConfig(
  family: FamilyPayoutColumns,
  kidOverrideJson: string | null
): PayoutConfig {
  return parseOverride(kidOverrideJson) ?? familyDefault(family);
}

/** Suggested weekly amount (cents) for a kid of `age` under `cfg`. Never negative. */
export function computeSuggestedCents(cfg: PayoutConfig, age: number): number {
  if (cfg.mode === 'fixed') return Math.max(0, cfg.fixedCents);
  return Math.max(0, Math.max(0, age) * cfg.centsPerYear + cfg.bonusCents);
}

/** Parse a non-negative dollar string ("1", "1.50") to integer cents, or null if invalid. */
export function dollarsToCents(input: string): number | null {
  const s = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
