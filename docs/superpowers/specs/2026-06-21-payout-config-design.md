# Configurable Payouts — Design Spec

**Date:** 2026-06-21
**Status:** Approved design, pre-implementation
**Context:** The weekly *suggested* payout is hardcoded as `age × $1` in
[payouts.ts](../../../src/lib/server/payouts.ts) (`suggested = Math.max(0, age) * 100`).
That locks every family into the original family's scheme. This feature makes the
suggested amount **configurable per family**, with an **optional per-kid override**, so
any household self-hosting the app can pick how allowance is calculated. The parent still
sets the *actual* amount at the weekly review — this only changes the **suggested** figure.

Follow-up to the cross-home work; first raised when generalizing the app for other
families.

---

## Goals & Non-Goals

### Goals
- A family chooses its payout scheme: **Fixed** (flat amount) or **Age-based**
  (`age × rate + bonus`).
- Any kid may **override** the family default with their own complete scheme (including
  their own fixed amount).
- **Zero behavior change** for existing data: defaults reproduce today's `age × $1`.

### Non-Goals
- No change to the weekly-review flow, the ledger, or how the *actual* amount is chosen.
- No automatic proration by chores-completed (responsibility stays the parent's
  judgment call at review, as today).
- No multi-currency; amounts stay integer **cents** (existing convention).

---

## Data Model

### Family default — four columns on `families`
| Column | Type | Default | Meaning |
|--------|------|---------|---------|
| `payout_mode` | text `'age' \| 'fixed'` | `'age'` | which formula |
| `payout_cents_per_year` | integer | `100` | age mode: $/year-of-age |
| `payout_bonus_cents` | integer | `0` | age mode: flat add-on |
| `payout_fixed_cents` | integer | `0` | fixed mode: the flat amount |

The defaults (`age`, 100, 0, 0) make every existing family compute exactly `age × $1`.

### Per-kid override — one nullable column on `persons`
- `payout_override` text (JSON), nullable. `null` = inherit the family default.
- When set: `{ "mode": "age"|"fixed", "centsPerYear": int, "bonusCents": int, "fixedCents": int }`
  — a **complete** scheme, so e.g. one kid can be flat $15 while a sibling inherits
  `age × $1`. (A single nullable column keeps "inherit vs custom" unambiguous, vs. four
  more nullable columns.)

---

## Computation — `src/lib/server/payout-config.ts` (pure, no DB)

```ts
export type PayoutMode = 'age' | 'fixed';
export interface PayoutConfig {
  mode: PayoutMode;
  centsPerYear: number;
  bonusCents: number;
  fixedCents: number;
}

// The suggested amount for a kid of `age` under `cfg`.
export function computeSuggestedCents(cfg: PayoutConfig, age: number): number {
  if (cfg.mode === 'fixed') return Math.max(0, cfg.fixedCents);
  return Math.max(0, age) * cfg.centsPerYear + cfg.bonusCents;
}

// Build a PayoutConfig from a family row's four columns.
export function familyDefault(family: {
  payoutMode: PayoutMode;
  payoutCentsPerYear: number;
  payoutBonusCents: number;
  payoutFixedCents: number;
}): PayoutConfig { … }

// Parse a kid's payout_override JSON → PayoutConfig, or null if absent/invalid.
export function parseOverride(json: string | null): PayoutConfig | null { … }

// kid override (if any) else family default.
export function resolvePayoutConfig(
  family: …, kidOverrideJson: string | null
): PayoutConfig {
  return parseOverride(kidOverrideJson) ?? familyDefault(family);
}
```

`parseOverride` validates shape/types and returns `null` on anything malformed (so a bad
override safely falls back to the family default rather than throwing).

---

## Integration — `payouts.ts`

`getCurrentWeekReview` currently computes `const suggested = Math.max(0, age) * 100;`
once per kid (the birthday-bump refresh reuses the same `suggested`). Changes:
- Load the family's four payout columns once at the top.
- Add `payoutOverride` to the per-kid `select`.
- Replace the hardcoded line with
  `const suggested = computeSuggestedCents(resolvePayoutConfig(family, kid.payoutOverride), age);`

Nothing else in the function changes; the get-or-create cycle and the open-cycle refresh
both keep working against the new `suggested`.

---

## UI — new `/settings/payouts` route (parent-only, PIN-gated)

Reuses the existing `/settings` gating pattern (`requireFreshPin`, parent-role check).
Kept as its own route so the PIN-only `/settings` page stays focused.

- **Family default** form: choose *Age-based* (rate $/yr + bonus $) or *Fixed* (amount $).
- **Per-kid** list: each kid shows "Using family default" with controls to set a custom
  scheme or revert to default.
- Amounts entered in **dollars** (e.g. `1.50`), converted to integer cents on save;
  reject negatives. A small dollars↔cents helper (parse + format) is unit-tested.
- Actions: `saveFamilyDefault`, `saveKidOverride`, `clearKidOverride`.
- A nav link to `/settings/payouts` from the existing settings/home area.

---

## Migration

One new Drizzle migration adds the four `families` columns (with the defaults above) and
the nullable `persons.payout_override`. Because the defaults reproduce `age × $1` and the
override defaults to `null`, **existing families and kids are unaffected**.

---

## Error Handling
- Malformed/edge inputs: `parseOverride` returns `null` (→ family default); `computeSuggestedCents` clamps negative `age` and negative `fixedCents` to 0.
- UI rejects negative dollar inputs with a field error; non-numeric input is treated as invalid (no save).

---

## Testing (existing in-memory migrated-DB Vitest harness)
- **`payout-config.test.ts`** (pure): `computeSuggestedCents` for fixed, age, age+bonus,
  age 0, negative age (clamped); `parseOverride` for valid JSON, `null`, and malformed
  input; `resolvePayoutConfig` override-vs-inherit. Plus the dollars↔cents helper.
- **`payouts.test.ts`** (integration): seed a family with a `fixed` default → a kid's
  `suggestedAmountCents` equals the fixed amount; seed a kid `payout_override` → that kid
  uses the override while a sibling without one uses the family default; default-config
  family still yields `age × 100` (no regression).

---

## Out of Scope / Future
- Per-kid override UI affordances beyond set/revert (e.g. bulk edit).
- Chore-based automatic proration of the suggested amount.
- Setting payout config during onboarding (kids inherit the family default; overrides are
  set later in `/settings/payouts`).
