# Configurable Payouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the weekly *suggested* payout configurable per family (Fixed OR age×rate+bonus) with an optional per-kid override, replacing the hardcoded `age × $1`.

**Architecture:** Add payout-config columns to `families` + a nullable `payout_override` JSON on `persons` (defaults reproduce `age × $1`). A pure `payout-config.ts` resolves and computes the suggested amount; `payouts.ts` calls it instead of the hardcoded formula. A `payout-settings.ts` lib does the family-scoped mutations, surfaced by a PIN-gated `/settings/payouts` page.

**Tech Stack:** SvelteKit (Svelte 4) + `adapter-node`, Drizzle ORM + SQLite (`better-sqlite3`), drizzle-kit migrations, Vitest with the existing in-memory migrated-DB harness.

**Reference spec:** `docs/superpowers/specs/2026-06-21-payout-config-design.md`

## Global Constraints

- Money is **integer cents** everywhere (existing convention). UI takes **dollars**, stores cents.
- **Zero behavior change for existing data:** family-column defaults are `payout_mode='age'`, `payout_cents_per_year=100`, `payout_bonus_cents=0`, `payout_fixed_cents=0`; `persons.payout_override` defaults `NULL`.
- This only changes the **suggested** amount; the parent still sets the *actual* amount at review. No change to the ledger, review flow, or responsibility logic.
- Svelte 4 / Vite 5 / Vitest 2 stack — do NOT upgrade any dependency.
- Do not add new `svelte-check` errors (baseline: 8 pre-existing).
- Reuse the existing seed helpers (`src/lib/server/test/seed.ts`) and in-memory DB harness.
- A malformed per-kid override must safely fall back to the family default (never throw).

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/lib/server/schema.ts` | Drizzle schema | Add 4 `families` cols + `persons.payout_override` |
| `drizzle/0003_*.sql` + `meta/*` | Migration | Generated via `npm run db:generate` |
| `src/lib/server/payout-config.ts` | Pure resolve/compute + dollars↔cents | Create |
| `src/lib/server/payout-config.test.ts` | Unit tests for the pure module | Create |
| `src/lib/server/payouts.ts` | Weekly review — use config for `suggested` | Modify `getCurrentWeekReview` |
| `src/lib/server/payouts.test.ts` | Schema-defaults + integration tests | Create |
| `src/lib/server/payout-settings.ts` | Family-scoped DB mutations | Create |
| `src/lib/server/payout-settings.test.ts` | Unit tests for the mutations | Create |
| `src/routes/settings/payouts/+page.server.ts` | Load + actions (thin, delegate to lib) | Create |
| `src/routes/settings/payouts/+page.svelte` | The settings UI | Create |
| `src/routes/settings/+page.svelte` | Add a link to `/settings/payouts` | Modify |

---

## Task 1: Schema columns + migration

**Files:**
- Modify: `src/lib/server/schema.ts`
- Generate: `drizzle/0003_*.sql` + `drizzle/meta/*` (via drizzle-kit)
- Test: `src/lib/server/payouts.test.ts` (create)

**Interfaces:**
- Produces: new Drizzle fields `families.payoutMode`, `families.payoutCentsPerYear`, `families.payoutBonusCents`, `families.payoutFixedCents`, and `persons.payoutOverride` (text, nullable) — consumed by Tasks 2–5.

- [ ] **Step 1: Add columns to `src/lib/server/schema.ts`.** In the `families` table definition, after the `payoutDay` line and before `createdAt`, add:

```ts
    // Payout scheme for the family (default reproduces the original "age in dollars").
    payoutMode: text('payout_mode', { enum: ['age', 'fixed'] }).notNull().default('age'),
    payoutCentsPerYear: integer('payout_cents_per_year').notNull().default(100),
    payoutBonusCents: integer('payout_bonus_cents').notNull().default(0),
    payoutFixedCents: integer('payout_fixed_cents').notNull().default(0),
```

In the `persons` table definition, after the `canPostCheers` line, add:

```ts
    // Per-kid payout override (JSON: {mode,centsPerYear,bonusCents,fixedCents}); null = inherit family.
    payoutOverride: text('payout_override'),
```

- [ ] **Step 2: Generate the migration**

Run: `cd H:/dev/allowance && npm run db:generate`
Expected: drizzle-kit prints that it created a new migration `drizzle/0003_<name>.sql` and updated `drizzle/meta/_journal.json` + a `0003_*_snapshot.json`. (Adding columns is unambiguous — it will not prompt.)

- [ ] **Step 3: Verify the generated SQL has the expected ALTERs**

Run: `cd H:/dev/allowance && cat drizzle/0003_*.sql`
Expected: contains `ALTER TABLE \`families\` ADD \`payout_mode\` text DEFAULT 'age' NOT NULL;` and the three other `families` columns, plus `ALTER TABLE \`persons\` ADD \`payout_override\` text;`. If any are missing, re-check Step 1 and re-run `npm run db:generate`.

- [ ] **Step 4: Write the failing test** — create `src/lib/server/payouts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import { seedFamily, seedKid } from '$lib/server/test/seed';

describe('payout config schema defaults', () => {
  it('new families default to the age × $1 scheme', async () => {
    const fam = seedFamily('Defaults Fam');
    const row = (await db
      .select({
        mode: schema.families.payoutMode,
        cpy: schema.families.payoutCentsPerYear,
        bonus: schema.families.payoutBonusCents,
        fixed: schema.families.payoutFixedCents,
      })
      .from(schema.families)
      .where(eq(schema.families.id, fam))
      .limit(1))[0];
    expect(row).toEqual({ mode: 'age', cpy: 100, bonus: 0, fixed: 0 });
  });

  it('new kids have a null payout_override', async () => {
    const fam = seedFamily('Defaults Fam');
    const kid = seedKid(fam, 'Kid');
    const row = (await db
      .select({ ov: schema.persons.payoutOverride })
      .from(schema.persons)
      .where(eq(schema.persons.id, kid))
      .limit(1))[0];
    expect(row.ov).toBeNull();
  });
});
```

- [ ] **Step 5: Run the test — it verifies the migration applied in the harness**

Run: `cd H:/dev/allowance && npm test -- payouts`
Expected: PASS (2 tests). (If it fails with "no such column", the harness didn't pick up the migration — confirm Step 2 updated `drizzle/meta/_journal.json`.)

- [ ] **Step 6: Run the full suite to confirm no regression**

Run: `cd H:/dev/allowance && npm test`
Expected: all previously-passing tests still green (+2 new).

- [ ] **Step 7: Commit** (include all generated drizzle files)

```bash
git -C H:/dev/allowance add src/lib/server/schema.ts src/lib/server/payouts.test.ts drizzle/
git -C H:/dev/allowance commit -m "feat(payouts): schema + migration for configurable payout columns"
```

Note: existing on-disk databases (e.g. a real `dev.db`) get this migration via `npm run db:migrate`; the test harness migrates a fresh in-memory DB automatically.

---

## Task 2: Pure `payout-config.ts` module

**Files:**
- Create: `src/lib/server/payout-config.ts`
- Test: `src/lib/server/payout-config.test.ts`

**Interfaces:**
- Produces:
  - `type PayoutMode = 'age' | 'fixed'`
  - `interface PayoutConfig { mode: PayoutMode; centsPerYear: number; bonusCents: number; fixedCents: number }`
  - `interface FamilyPayoutColumns { payoutMode: PayoutMode; payoutCentsPerYear: number; payoutBonusCents: number; payoutFixedCents: number }`
  - `familyDefault(f: FamilyPayoutColumns): PayoutConfig`
  - `parseOverride(json: string | null): PayoutConfig | null`
  - `resolvePayoutConfig(family: FamilyPayoutColumns, kidOverrideJson: string | null): PayoutConfig`
  - `computeSuggestedCents(cfg: PayoutConfig, age: number): number`
  - `dollarsToCents(input: string): number | null`
  - `centsToDollars(cents: number): string`
- Consumed by Tasks 3 (`resolvePayoutConfig`, `computeSuggestedCents`) and 5 (`dollarsToCents`, `centsToDollars`).

- [ ] **Step 1: Write the failing test** — create `src/lib/server/payout-config.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd H:/dev/allowance && npm test -- payout-config`
Expected: FAIL — `./payout-config` does not exist.

- [ ] **Step 3: Create `src/lib/server/payout-config.ts`:**

```ts
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
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd H:/dev/allowance && npm test -- payout-config`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git -C H:/dev/allowance add src/lib/server/payout-config.ts src/lib/server/payout-config.test.ts
git -C H:/dev/allowance commit -m "feat(payouts): pure payout-config resolve/compute + dollars helpers"
```

---

## Task 3: Use the config in `payouts.ts`

**Files:**
- Modify: `src/lib/server/payouts.ts` (`getCurrentWeekReview` only)
- Test: `src/lib/server/payouts.test.ts` (append integration tests)

**Interfaces:**
- Consumes: `resolvePayoutConfig`, `computeSuggestedCents` from `./payout-config` (Task 2); the new schema columns (Task 1).

- [ ] **Step 1: Append failing integration tests to `src/lib/server/payouts.test.ts`:**

```ts
import { getCurrentWeekReview } from '$lib/server/payouts';
import { ageOn } from '$lib/server/dates';
import { todayIso } from '$lib/server/dates';

describe('getCurrentWeekReview honors payout config', () => {
  it('default family → age × $1', async () => {
    const fam = seedFamily('Age Fam');
    const kid = seedKid(fam, 'Amy', '2016-01-01');
    const age = ageOn('2016-01-01', todayIso());
    const items = await getCurrentWeekReview(fam);
    const item = items.find((i) => i.kidId === kid)!;
    expect(item.suggestedAmountCents).toBe(age * 100);
  });

  it('fixed family default → flat amount, age ignored', async () => {
    const fam = seedFamily('Fixed Fam');
    const kid = seedKid(fam, 'Ben', '2010-01-01');
    db.update(schema.families)
      .set({ payoutMode: 'fixed', payoutFixedCents: 2500 })
      .where(eq(schema.families.id, fam))
      .run();
    const items = await getCurrentWeekReview(fam);
    expect(items.find((i) => i.kidId === kid)!.suggestedAmountCents).toBe(2500);
  });

  it('per-kid override wins; sibling without one uses family default', async () => {
    const fam = seedFamily('Mixed Fam');
    const a = seedKid(fam, 'Mia', '2016-01-01'); // override → fixed 1500
    const b = seedKid(fam, 'Leo', '2014-01-01'); // inherits age × $1
    db.update(schema.persons)
      .set({ payoutOverride: '{"mode":"fixed","centsPerYear":0,"bonusCents":0,"fixedCents":1500}' })
      .where(eq(schema.persons.id, a))
      .run();
    const items = await getCurrentWeekReview(fam);
    expect(items.find((i) => i.kidId === a)!.suggestedAmountCents).toBe(1500);
    expect(items.find((i) => i.kidId === b)!.suggestedAmountCents).toBe(
      ageOn('2014-01-01', todayIso()) * 100
    );
  });
});
```

- [ ] **Step 2: Run to confirm the new tests fail**

Run: `cd H:/dev/allowance && npm test -- payouts`
Expected: the three new tests FAIL (suggested still hardcoded to `age × 100`, so the fixed/override cases mismatch).

- [ ] **Step 3: Edit `src/lib/server/payouts.ts`.**

(a) Add an import after the existing `./dates` import:
```ts
import { resolvePayoutConfig, computeSuggestedCents } from './payout-config';
```

(b) Inside `getCurrentWeekReview`, after the `const wkEnd = weekEnding(today);` line, load the family's payout columns:
```ts
  const famRows = await db
    .select({
      payoutMode: schema.families.payoutMode,
      payoutCentsPerYear: schema.families.payoutCentsPerYear,
      payoutBonusCents: schema.families.payoutBonusCents,
      payoutFixedCents: schema.families.payoutFixedCents,
    })
    .from(schema.families)
    .where(eq(schema.families.id, familyId))
    .limit(1);
  const family = famRows[0];
  if (!family) return [];
```

(c) Add `payoutOverride` to the kids `select` (so the object becomes):
```ts
    .select({
      id: schema.persons.id,
      name: schema.persons.name,
      birthdate: schema.persons.birthdate,
      payoutOverride: schema.persons.payoutOverride,
    })
```

(d) Replace the line `const suggested = Math.max(0, age) * 100;` with:
```ts
    const suggested = computeSuggestedCents(resolvePayoutConfig(family, kid.payoutOverride), age);
```

- [ ] **Step 4: Run the payouts tests to confirm they pass**

Run: `cd H:/dev/allowance && npm test -- payouts`
Expected: PASS (the 2 schema tests + 3 integration tests).

- [ ] **Step 5: Full suite + type-check**

Run: `cd H:/dev/allowance && npm test && npm run check`
Expected: all tests green; `npm run check` at the 8-error baseline (no new errors).

- [ ] **Step 6: Commit**

```bash
git -C H:/dev/allowance add src/lib/server/payouts.ts src/lib/server/payouts.test.ts
git -C H:/dev/allowance commit -m "feat(payouts): compute suggested amount from configurable payout scheme"
```

---

## Task 4: `payout-settings.ts` mutation lib

**Files:**
- Create: `src/lib/server/payout-settings.ts`
- Test: `src/lib/server/payout-settings.test.ts`

**Interfaces:**
- Consumes: `PayoutMode` from `./payout-config` (Task 2); schema (Task 1).
- Produces:
  - `saveFamilyDefault(familyId: string, input: { mode: PayoutMode; rateCents: number; bonusCents: number; fixedCents: number }): Promise<void>`
  - `saveKidOverride(familyId: string, kidId: string, cfg: { mode: PayoutMode; centsPerYear: number; bonusCents: number; fixedCents: number }): Promise<void>`
  - `clearKidOverride(familyId: string, kidId: string): Promise<void>`
  - Consumed by Task 5's route actions. (kid mutations are scoped to `familyId` so a parent can't edit another family's kid.)

- [ ] **Step 1: Write the failing test** — create `src/lib/server/payout-settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import { seedFamily, seedKid } from '$lib/server/test/seed';
import { saveFamilyDefault, saveKidOverride, clearKidOverride } from './payout-settings';

describe('payout-settings mutations', () => {
  it('saveFamilyDefault writes the four columns', async () => {
    const fam = seedFamily('Fam');
    await saveFamilyDefault(fam, { mode: 'fixed', rateCents: 0, bonusCents: 0, fixedCents: 2000 });
    const row = (await db
      .select({
        mode: schema.families.payoutMode,
        fixed: schema.families.payoutFixedCents,
      })
      .from(schema.families)
      .where(eq(schema.families.id, fam))
      .limit(1))[0];
    expect(row).toEqual({ mode: 'fixed', fixed: 2000 });
  });

  it('saveKidOverride stores JSON; clearKidOverride nulls it', async () => {
    const fam = seedFamily('Fam');
    const kid = seedKid(fam, 'Kid');
    await saveKidOverride(fam, kid, { mode: 'fixed', centsPerYear: 0, bonusCents: 0, fixedCents: 1500 });
    let ov = (await db.select({ ov: schema.persons.payoutOverride }).from(schema.persons).where(eq(schema.persons.id, kid)).limit(1))[0].ov;
    expect(JSON.parse(ov!)).toEqual({ mode: 'fixed', centsPerYear: 0, bonusCents: 0, fixedCents: 1500 });
    await clearKidOverride(fam, kid);
    ov = (await db.select({ ov: schema.persons.payoutOverride }).from(schema.persons).where(eq(schema.persons.id, kid)).limit(1))[0].ov;
    expect(ov).toBeNull();
  });

  it('kid mutations are scoped to the family (no cross-family edit)', async () => {
    const famA = seedFamily('A');
    const famB = seedFamily('B');
    const kidB = seedKid(famB, 'KidB');
    // famA tries to override famB's kid — must not take effect.
    await saveKidOverride(famA, kidB, { mode: 'fixed', centsPerYear: 0, bonusCents: 0, fixedCents: 9999 });
    const ov = (await db.select({ ov: schema.persons.payoutOverride }).from(schema.persons).where(eq(schema.persons.id, kidB)).limit(1))[0].ov;
    expect(ov).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd H:/dev/allowance && npm test -- payout-settings`
Expected: FAIL — `./payout-settings` does not exist.

- [ ] **Step 3: Create `src/lib/server/payout-settings.ts`:**

```ts
// Family-scoped payout-config mutations. The route layer parses the form and
// calls these; kid edits are scoped to familyId so a parent can't touch another
// family's kid.

import { and, eq } from 'drizzle-orm';
import { db, schema } from './db';
import type { PayoutMode } from './payout-config';

export async function saveFamilyDefault(
  familyId: string,
  input: { mode: PayoutMode; rateCents: number; bonusCents: number; fixedCents: number }
): Promise<void> {
  db.update(schema.families)
    .set({
      payoutMode: input.mode,
      payoutCentsPerYear: input.rateCents,
      payoutBonusCents: input.bonusCents,
      payoutFixedCents: input.fixedCents,
    })
    .where(eq(schema.families.id, familyId))
    .run();
}

export async function saveKidOverride(
  familyId: string,
  kidId: string,
  cfg: { mode: PayoutMode; centsPerYear: number; bonusCents: number; fixedCents: number }
): Promise<void> {
  db.update(schema.persons)
    .set({ payoutOverride: JSON.stringify(cfg) })
    .where(and(eq(schema.persons.id, kidId), eq(schema.persons.familyId, familyId)))
    .run();
}

export async function clearKidOverride(familyId: string, kidId: string): Promise<void> {
  db.update(schema.persons)
    .set({ payoutOverride: null })
    .where(and(eq(schema.persons.id, kidId), eq(schema.persons.familyId, familyId)))
    .run();
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd H:/dev/allowance && npm test -- payout-settings`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git -C H:/dev/allowance add src/lib/server/payout-settings.ts src/lib/server/payout-settings.test.ts
git -C H:/dev/allowance commit -m "feat(payouts): family-scoped payout-settings mutation lib"
```

---

## Task 5: `/settings/payouts` route + nav link

**Files:**
- Create: `src/routes/settings/payouts/+page.server.ts`
- Create: `src/routes/settings/payouts/+page.svelte`
- Modify: `src/routes/settings/+page.svelte` (add a link)

**Interfaces:**
- Consumes: `requireFreshPin` (`$lib/server/pinGuard`), `dollarsToCents`/`centsToDollars`/`parseOverride` (`$lib/server/payout-config`), `saveFamilyDefault`/`saveKidOverride`/`clearKidOverride` (`$lib/server/payout-settings`).
- This task has no unit test (the app has no Svelte component-test harness); the mutation logic it calls is already covered by Task 4. Verified by `svelte-check` + build.

- [ ] **Step 1: Create `src/routes/settings/payouts/+page.server.ts`:**

```ts
// /settings/payouts — parent-only, PIN-gated. Set the family payout scheme + per-kid overrides.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireFreshPin } from '$lib/server/pinGuard';
import { db, schema } from '$lib/server/db';
import { dollarsToCents, centsToDollars, parseOverride } from '$lib/server/payout-config';
import { saveFamilyDefault, saveKidOverride, clearKidOverride } from '$lib/server/payout-settings';
import type { PayoutMode } from '$lib/server/payout-config';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.session) throw redirect(303, '/claim');
  if (locals.session.role !== 'parent') throw error(403, 'Parents only');
  await requireFreshPin(locals.session, '/settings/payouts');

  const fam = (await db
    .select({
      mode: schema.families.payoutMode,
      cpy: schema.families.payoutCentsPerYear,
      bonus: schema.families.payoutBonusCents,
      fixed: schema.families.payoutFixedCents,
    })
    .from(schema.families)
    .where(eq(schema.families.id, locals.session.familyId))
    .limit(1))[0];

  const kidRows = await db
    .select({ id: schema.persons.id, name: schema.persons.name, override: schema.persons.payoutOverride })
    .from(schema.persons)
    .where(and(eq(schema.persons.familyId, locals.session.familyId), eq(schema.persons.role, 'kid')));

  return {
    family: {
      mode: fam.mode,
      rate: centsToDollars(fam.cpy),
      bonus: centsToDollars(fam.bonus),
      fixed: centsToDollars(fam.fixed),
    },
    kids: kidRows.map((k) => {
      const o = parseOverride(k.override);
      return {
        id: k.id,
        name: k.name,
        hasOverride: o !== null,
        mode: o?.mode ?? ('age' as PayoutMode),
        rate: centsToDollars(o?.centsPerYear ?? 100),
        bonus: centsToDollars(o?.bonusCents ?? 0),
        fixed: centsToDollars(o?.fixedCents ?? 0),
      };
    }),
  };
};

function parseScheme(d: FormData): { mode: PayoutMode; rate: number; bonus: number; fixed: number } | null {
  const mode = d.get('mode')?.toString();
  if (mode !== 'age' && mode !== 'fixed') return null;
  const rate = dollarsToCents(d.get('rate')?.toString() ?? '0');
  const bonus = dollarsToCents(d.get('bonus')?.toString() ?? '0');
  const fixed = dollarsToCents(d.get('fixed')?.toString() ?? '0');
  if (rate === null || bonus === null || fixed === null) return null;
  return { mode, rate, bonus, fixed };
}

export const actions: Actions = {
  saveFamily: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') return fail(403, { error: 'Parents only' });
    const s = parseScheme(await request.formData());
    if (!s) return fail(400, { error: 'Amounts must be non-negative numbers.' });
    await saveFamilyDefault(locals.session.familyId, {
      mode: s.mode,
      rateCents: s.rate,
      bonusCents: s.bonus,
      fixedCents: s.fixed,
    });
    return { ok: true, message: 'Family default saved.' };
  },

  saveKid: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') return fail(403, { error: 'Parents only' });
    const d = await request.formData();
    const kidId = d.get('kidId')?.toString() ?? '';
    const s = parseScheme(d);
    if (!kidId || !s) return fail(400, { error: 'Amounts must be non-negative numbers.' });
    await saveKidOverride(locals.session.familyId, kidId, {
      mode: s.mode,
      centsPerYear: s.rate,
      bonusCents: s.bonus,
      fixedCents: s.fixed,
    });
    return { ok: true, message: 'Override saved.' };
  },

  clearKid: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') return fail(403, { error: 'Parents only' });
    const kidId = (await request.formData()).get('kidId')?.toString() ?? '';
    if (!kidId) return fail(400, { error: 'Missing kid.' });
    await clearKidOverride(locals.session.familyId, kidId);
    return { ok: true, message: 'Reverted to family default.' };
  },
};
```

- [ ] **Step 2: Create `src/routes/settings/payouts/+page.svelte`:**

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  export let data: PageData;
  export let form: ActionData;
</script>

<svelte:head><title>Payouts</title></svelte:head>

<header>
  <a href="/settings" class="text-sm text-slate-500 hover:text-slate-800">← Settings</a>
  <h1 class="text-2xl font-semibold mt-1">Payouts</h1>
  <p class="text-xs text-slate-500 mt-1">
    Sets the <em>suggested</em> weekly amount. You still choose the actual amount at review.
  </p>
</header>

{#if form?.error}
  <p class="mt-3 rounded bg-red-100 p-3 text-red-800 text-sm">{form.error}</p>
{:else if form?.ok}
  <p class="mt-3 rounded bg-green-100 p-3 text-green-800 text-sm">{form.message}</p>
{/if}

<section class="mt-6 rounded-xl border border-slate-200 bg-white p-4">
  <h2 class="font-medium">Family default</h2>
  <form method="POST" action="?/saveFamily" use:enhance class="mt-3 space-y-3">
    <label class="flex items-center gap-2 text-sm">
      <input type="radio" name="mode" value="age" checked={data.family.mode === 'age'} /> Age-based
    </label>
    <div class="grid grid-cols-2 gap-2 pl-6">
      <label class="text-xs">$/year of age
        <input name="rate" value={data.family.rate} inputmode="decimal"
          class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm" /></label>
      <label class="text-xs">Bonus $
        <input name="bonus" value={data.family.bonus} inputmode="decimal"
          class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm" /></label>
    </div>
    <label class="flex items-center gap-2 text-sm">
      <input type="radio" name="mode" value="fixed" checked={data.family.mode === 'fixed'} /> Fixed amount
    </label>
    <div class="pl-6">
      <label class="text-xs">Amount $
        <input name="fixed" value={data.family.fixed} inputmode="decimal"
          class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm" /></label>
    </div>
    <button class="w-full rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-2 text-sm font-medium">
      Save family default
    </button>
  </form>
</section>

{#each data.kids as kid (kid.id)}
  <section class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
    <div class="flex items-center justify-between">
      <h3 class="font-medium text-sm">{kid.name}</h3>
      <span class="text-xs text-slate-500">{kid.hasOverride ? 'Custom' : 'Using family default'}</span>
    </div>
    <form method="POST" action="?/saveKid" use:enhance class="mt-3 space-y-2">
      <input type="hidden" name="kidId" value={kid.id} />
      <label class="flex items-center gap-2 text-sm">
        <input type="radio" name="mode" value="age" checked={kid.mode === 'age'} /> Age-based
      </label>
      <div class="grid grid-cols-2 gap-2 pl-6">
        <label class="text-xs">$/year
          <input name="rate" value={kid.rate} inputmode="decimal"
            class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm" /></label>
        <label class="text-xs">Bonus $
          <input name="bonus" value={kid.bonus} inputmode="decimal"
            class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm" /></label>
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input type="radio" name="mode" value="fixed" checked={kid.mode === 'fixed'} /> Fixed
      </label>
      <div class="pl-6">
        <label class="text-xs">Amount $
          <input name="fixed" value={kid.fixed} inputmode="decimal"
            class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm" /></label>
      </div>
      <div class="flex gap-2">
        <button class="flex-1 rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-2 text-sm font-medium">
          Save override
        </button>
      </div>
    </form>
    {#if kid.hasOverride}
      <form method="POST" action="?/clearKid" use:enhance class="mt-2">
        <input type="hidden" name="kidId" value={kid.id} />
        <button class="w-full rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 py-2 text-sm font-medium">
          Use family default
        </button>
      </form>
    {/if}
  </section>
{/each}
```

- [ ] **Step 3: Add a link from `src/routes/settings/+page.svelte`.** Immediately after the `{#if form?.error}…{/if}` block (the block that ends at the line `{/if}` before the "Notifications on this device" section), insert:

```svelte
<section class="mt-6 rounded-xl border border-slate-200 bg-white p-4">
  <a href="/settings/payouts" class="flex items-center justify-between">
    <span class="font-medium">Payouts</span>
    <span class="text-slate-400 text-sm">Configure suggested amounts →</span>
  </a>
</section>
```

- [ ] **Step 4: Type-check (no new errors) and build**

Run: `cd H:/dev/allowance && npm run check`
Expected: completes at the **8-error baseline** (no new errors from the new route). If a new error appears in the new files, fix it minimally and re-run.

Run: `cd H:/dev/allowance && npm run build`
Expected: ends with `Using @sveltejs/adapter-node` / `✔ done`.

- [ ] **Step 5: Full suite once more**

Run: `cd H:/dev/allowance && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git -C H:/dev/allowance add src/routes/settings/payouts/+page.server.ts src/routes/settings/payouts/+page.svelte src/routes/settings/+page.svelte
git -C H:/dev/allowance commit -m "feat(payouts): /settings/payouts UI for family default + per-kid overrides"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** Family columns + per-kid override JSON → Task 1. `computeSuggestedCents`/`familyDefault`/`parseOverride`/`resolvePayoutConfig` + dollars↔cents → Task 2. `payouts.ts` integration (suggested only) → Task 3. `/settings/payouts` parent+PIN UI with family default + per-kid set/clear, dollars→cents → Tasks 4–5. Migration with zero-behavior-change defaults → Task 1. Malformed-override-falls-back → Task 2 (`parseOverride` + `resolvePayoutConfig`) tested. Family-scoped kid edits → Task 4.
- **Placeholder scan:** none — every step has complete code/commands. The only non-literal is the generated migration filename `0003_*.sql` (drizzle-kit names it), which Step 3 of Task 1 verifies by content, not name.
- **Type consistency:** `PayoutMode`, `PayoutConfig`, `FamilyPayoutColumns` defined in Task 2 and used identically in Tasks 3–5. `saveFamilyDefault(familyId, {mode,rateCents,bonusCents,fixedCents})`, `saveKidOverride(familyId, kidId, {mode,centsPerYear,bonusCents,fixedCents})`, `clearKidOverride(familyId, kidId)` signatures match between Task 4's definition and Task 5's calls. Schema field names (`payoutMode`, `payoutCentsPerYear`, `payoutBonusCents`, `payoutFixedCents`, `payoutOverride`) consistent across Tasks 1, 3, 4, 5.
- **Constraints:** cents in DB / dollars in UI; Svelte 4 stack untouched; no new deps; svelte-check baseline guarded in Tasks 3 & 5.
