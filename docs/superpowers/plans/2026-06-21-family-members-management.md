# Family Members Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a parent add, edit, and archive family members (kids + co-parents) from both a PIN-gated Settings screen and a now-working first-run wizard, replacing the dead `/setup/kids` step.

**Architecture:** One server module (`members.ts`) owns all member CRUD + setup completion; one Svelte component (`MemberManager.svelte`) renders the list+forms; two thin route surfaces (`/settings/members`, the renamed `/setup/members`) wrap it. "Setup complete" becomes an explicit `app_config` marker so the wizard's later steps stay reachable. Removal is archival (an `active` flag), never a destructive delete.

**Tech Stack:** SvelteKit (Svelte 4, `adapter-node`), better-sqlite3 + Drizzle (synchronous driver: `await` on `.select()`, `.run()` on writes), drizzle-kit migrations, Vitest (in-memory migrated-DB harness), Tailwind.

## Global Constraints

- **Svelte 4** (not 5). Drizzle writes use `.run()`; selects are `await`ed. IDs via `crypto.randomUUID()`; timestamps `Date.now()` (ms); birthdates ISO `YYYY-MM-DD`.
- **Removal = archive only.** Never hard-delete a person (their chores, payout cycles, and ledger cascade-delete). Archiving sets `persons.active = false`; reversible via restore.
- **Co-parent add = name only.** No PIN field in any add form; co-parents set their own PIN later via Settings → Parent PIN.
- **Setup completion is explicit:** `isSetupComplete()` returns `(await getConfig('setup_completed')) === '1'`. Only `completeSetup()` sets that key. Migration `0004` backfills it for any DB that already has a parent (so existing prod/dev installs stay complete).
- **Archived members must be filtered out of every kid/person read path** enumerated in Tasks 3–4 (chore assignment, review, leaderboard, home summaries, cheer perms, claim list, setup helpers). Archived members keep their ledger/history.
- **PIN gate:** `/settings/members` is parents-only + `requireFreshPin(session, '/settings/members')` when a PIN is set (mirrors `/settings/payouts`). The wizard `/setup/members` step has **no** auth (it runs pre-claim, like the old `/setup/kids`).
- **Shared component:** `MemberManager.svelte` is used by both surfaces; its forms post to the action names `?/addKid`, `?/addParent`, `?/edit`, `?/archive`, `?/restore`, which **both** routes implement.

---

### Task 1: Schema `active` column + setup-completion marker (migration 0004)

**Files:**
- Modify: `src/lib/server/schema.ts` (add `persons.active`)
- Create: `drizzle/0004_*.sql` (+ `drizzle/meta/0004_snapshot.json` + `_journal.json` entry, via `drizzle-kit generate`)
- Modify: `src/lib/server/setup.ts:10-22` (`isSetupComplete` → marker)
- Test: `src/lib/server/setup-marker.test.ts`

**Interfaces:**
- Produces: `persons.active` boolean column (default `true`); `isSetupComplete(): Promise<boolean>` now reads `app_config['setup_completed']`.
- Consumes: `getConfig(key): Promise<string | null>` from `src/lib/server/config.ts`.

- [ ] **Step 1: Add the column to the schema.** In `src/lib/server/schema.ts`, in the `persons` table (after the `payoutOverride` line, before `parentPinHash`), add:

```ts
    // Soft-archive flag. Archived members keep their ledger/history but drop out of
    // active views (chore assignment, review, leaderboard, claim).
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
```

- [ ] **Step 2: Generate the migration.**

Run: `cd H:/dev/allowance && npm run db:generate`
Expected: creates `drizzle/0004_<random>.sql` containing a single `ALTER TABLE \`persons\` ADD \`active\` integer DEFAULT true NOT NULL;` (drizzle may render the default as `true` or `1`; either is valid SQLite), updates `drizzle/meta/_journal.json` with an `idx: 4` entry, and writes `drizzle/meta/0004_snapshot.json`. Confirm the `.sql` contains ONLY the `active` ADD (no unrelated statements).

- [ ] **Step 3: Append the backfill statement** to the generated `drizzle/0004_*.sql` (add a breakpoint + the INSERT at the end of the file):

```sql
--> statement-breakpoint
INSERT OR IGNORE INTO `app_config` (`key`, `value`) SELECT 'setup_completed', '1' WHERE EXISTS (SELECT 1 FROM `persons` WHERE `role` = 'parent');
```

- [ ] **Step 4: Rewrite `isSetupComplete()`** in `src/lib/server/setup.ts`. Replace the existing function body (lines 10-22) with:

```ts
import { getConfig } from './config';

// Setup is "complete" once the wizard's final step records it explicitly (see
// completeSetup() in members.ts). Migration 0004 backfills this marker for any
// pre-existing install that already had a parent.
export async function isSetupComplete(): Promise<boolean> {
  return (await getConfig('setup_completed')) === '1';
}
```

(Keep the `import` near the top of the file with the other imports; leave `getOrInitOnlyFamily` and `getFirstParent` unchanged for now — Task 3 edits them.)

- [ ] **Step 5: Write the failing tests.** Create `src/lib/server/setup-marker.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { seedFamily, seedKid } from './test/seed';
import { db, schema } from './db';
import { eq } from 'drizzle-orm';
import { setConfig } from './config';
import { isSetupComplete } from './setup';

describe('persons.active column', () => {
  it('defaults to true for a newly inserted person', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    const rows = await db
      .select({ active: schema.persons.active })
      .from(schema.persons)
      .where(eq(schema.persons.id, kid));
    expect(rows[0].active).toBe(true);
  });
});

describe('isSetupComplete marker', () => {
  it('is false with no marker and true once the marker is set', async () => {
    expect(await isSetupComplete()).toBe(false);
    await setConfig('setup_completed', '1');
    expect(await isSetupComplete()).toBe(true);
  });
});

describe('0004 backfill SQL', () => {
  const BACKFILL =
    `INSERT OR IGNORE INTO app_config (key, value) SELECT 'setup_completed', '1' WHERE EXISTS (SELECT 1 FROM persons WHERE role = 'parent');`;
  function freshDb() {
    const s = new Database(':memory:');
    s.exec(`CREATE TABLE persons (id text primary key, role text);`);
    s.exec(`CREATE TABLE app_config (key text primary key, value text);`);
    return s;
  }
  it('sets the marker when a parent exists', () => {
    const s = freshDb();
    s.exec(`INSERT INTO persons (id, role) VALUES ('p1','parent');`);
    s.exec(BACKFILL);
    const row = s.prepare(`SELECT value FROM app_config WHERE key='setup_completed'`).get() as { value: string } | undefined;
    expect(row?.value).toBe('1');
    s.close();
  });
  it('does nothing when no parent exists', () => {
    const s = freshDb();
    s.exec(BACKFILL);
    const row = s.prepare(`SELECT value FROM app_config WHERE key='setup_completed'`).get();
    expect(row).toBeUndefined();
    s.close();
  });
});
```

- [ ] **Step 6: Run the tests.**

Run: `cd H:/dev/allowance && npx svelte-kit sync && npm test -- setup-marker`
Expected: PASS (4 tests). If the harness errors that `active` is unknown, the migration wasn't picked up — re-check Steps 1-3.

- [ ] **Step 7: Run the full suite** to confirm the new column didn't break existing tests.

Run: `npm test`
Expected: all green (previously 55, now 59).

- [ ] **Step 8: Commit.**

```bash
git add src/lib/server/schema.ts drizzle/ src/lib/server/setup.ts src/lib/server/setup-marker.test.ts
git commit -m "feat(members): add persons.active + explicit setup-complete marker (migration 0004)"
```

---

### Task 2: `members.ts` server module

**Files:**
- Create: `src/lib/server/members.ts`
- Test: `src/lib/server/members.test.ts`

**Interfaces:**
- Consumes: `db`, `schema` from `./db`; `setConfig` from `./config`; `isSetupComplete` from `./setup` (test only).
- Produces:
  - `type MemberRow = { id: string; name: string; birthdate: string | null; active: boolean; hasPin?: boolean }`
  - `listMembers(familyId): Promise<{ parents: MemberRow[]; kids: MemberRow[] }>`
  - `addKid({ familyId, name, birthdate }): Promise<string>`
  - `addParent({ familyId, name }): Promise<string>`
  - `editMember({ id, familyId, name, birthdate? }): Promise<void>`
  - `archiveMember({ id, familyId }): Promise<void>`
  - `restoreMember({ id, familyId }): Promise<void>`
  - `completeSetup(): Promise<void>`

- [ ] **Step 1: Write the failing tests.** Create `src/lib/server/members.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { seedFamily } from './test/seed';
import {
  listMembers, addKid, addParent, editMember, archiveMember, restoreMember, completeSetup,
} from './members';
import { isSetupComplete } from './setup';

describe('members module', () => {
  it('adds a kid (trims name, stores birthdate, active by default)', async () => {
    const fam = seedFamily();
    const id = await addKid({ familyId: fam, name: '  Mia  ', birthdate: '2016-05-01' });
    const { kids } = await listMembers(fam);
    expect(kids).toHaveLength(1);
    expect(kids[0]).toMatchObject({ id, name: 'Mia', birthdate: '2016-05-01', active: true });
  });

  it('rejects a kid with a malformed birthdate', async () => {
    const fam = seedFamily();
    await expect(addKid({ familyId: fam, name: 'Mia', birthdate: '05/01/2016' })).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('rejects an empty name', async () => {
    const fam = seedFamily();
    await expect(addParent({ familyId: fam, name: '   ' })).rejects.toThrow(/Name is required/);
  });

  it('adds a co-parent with no birthdate and no PIN', async () => {
    const fam = seedFamily();
    const id = await addParent({ familyId: fam, name: 'Mom' });
    const { parents } = await listMembers(fam);
    expect(parents.find((p) => p.id === id)).toMatchObject({ name: 'Mom', birthdate: null, active: true, hasPin: false });
  });

  it('edits a kid name and birthdate', async () => {
    const fam = seedFamily();
    const id = await addKid({ familyId: fam, name: 'Mia', birthdate: '2016-05-01' });
    await editMember({ id, familyId: fam, name: 'Mia Rose', birthdate: '2015-04-02' });
    const { kids } = await listMembers(fam);
    expect(kids[0]).toMatchObject({ name: 'Mia Rose', birthdate: '2015-04-02' });
  });

  it('archives and restores a kid', async () => {
    const fam = seedFamily();
    const id = await addKid({ familyId: fam, name: 'Mia', birthdate: '2016-05-01' });
    await archiveMember({ id, familyId: fam });
    expect((await listMembers(fam)).kids[0].active).toBe(false);
    await restoreMember({ id, familyId: fam });
    expect((await listMembers(fam)).kids[0].active).toBe(true);
  });

  it('refuses to archive the only active parent', async () => {
    const fam = seedFamily();
    const p = await addParent({ familyId: fam, name: 'Dad' });
    await expect(archiveMember({ id: p, familyId: fam })).rejects.toThrow(/only parent/i);
  });

  it('allows archiving a parent when another active parent remains', async () => {
    const fam = seedFamily();
    const p1 = await addParent({ familyId: fam, name: 'Dad' });
    await addParent({ familyId: fam, name: 'Mom' });
    await expect(archiveMember({ id: p1, familyId: fam })).resolves.toBeUndefined();
  });

  it('treats an id from another family as not found', async () => {
    const famA = seedFamily('A');
    const famB = seedFamily('B');
    const id = await addKid({ familyId: famA, name: 'Mia', birthdate: '2016-05-01' });
    await expect(editMember({ id, familyId: famB, name: 'X' })).rejects.toThrow(/not found/i);
  });

  it('completeSetup makes isSetupComplete true', async () => {
    expect(await isSetupComplete()).toBe(false);
    await completeSetup();
    expect(await isSetupComplete()).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `npx svelte-kit sync && npm test -- members`
Expected: FAIL (cannot find module `./members`).

- [ ] **Step 3: Implement `src/lib/server/members.ts`:**

```ts
// Family member management: add/edit kids & co-parents, archive (never delete),
// and record explicit setup completion. Shared by /settings/members and the
// /setup/members wizard step.

import { and, eq } from 'drizzle-orm';
import { db, schema } from './db';
import { setConfig } from './config';

export type MemberRow = {
  id: string;
  name: string;
  birthdate: string | null;
  active: boolean;
  hasPin?: boolean; // parents only
};

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function listMembers(
  familyId: string
): Promise<{ parents: MemberRow[]; kids: MemberRow[] }> {
  const rows = await db
    .select({
      id: schema.persons.id,
      name: schema.persons.name,
      role: schema.persons.role,
      birthdate: schema.persons.birthdate,
      active: schema.persons.active,
      parentPinHash: schema.persons.parentPinHash,
    })
    .from(schema.persons)
    .where(eq(schema.persons.familyId, familyId));

  const parents = rows
    .filter((r) => r.role === 'parent')
    .map((r) => ({ id: r.id, name: r.name, birthdate: r.birthdate, active: r.active, hasPin: r.parentPinHash != null }));
  const kids = rows
    .filter((r) => r.role === 'kid')
    .map((r) => ({ id: r.id, name: r.name, birthdate: r.birthdate, active: r.active }));
  return { parents, kids };
}

export async function addKid(input: { familyId: string; name: string; birthdate: string }): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('Name is required');
  if (!isIsoDate(input.birthdate)) throw new Error('Birthdate must be YYYY-MM-DD');
  const id = crypto.randomUUID();
  db.insert(schema.persons)
    .values({ id, familyId: input.familyId, name, role: 'kid', birthdate: input.birthdate, active: true, createdAt: Date.now() })
    .run();
  return id;
}

export async function addParent(input: { familyId: string; name: string }): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('Name is required');
  const id = crypto.randomUUID();
  db.insert(schema.persons)
    .values({ id, familyId: input.familyId, name, role: 'parent', active: true, createdAt: Date.now() })
    .run();
  return id;
}

async function findInFamily(id: string, familyId: string) {
  const rows = await db
    .select({ id: schema.persons.id, familyId: schema.persons.familyId, role: schema.persons.role })
    .from(schema.persons)
    .where(eq(schema.persons.id, id))
    .limit(1);
  const m = rows[0];
  if (!m || m.familyId !== familyId) throw new Error('Member not found');
  return m;
}

export async function editMember(input: { id: string; familyId: string; name: string; birthdate?: string }): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new Error('Name is required');
  const member = await findInFamily(input.id, input.familyId);
  const patch: { name: string; birthdate?: string } = { name };
  if (member.role === 'kid' && input.birthdate !== undefined) {
    if (!isIsoDate(input.birthdate)) throw new Error('Birthdate must be YYYY-MM-DD');
    patch.birthdate = input.birthdate;
  }
  db.update(schema.persons).set(patch).where(eq(schema.persons.id, input.id)).run();
}

export async function archiveMember(input: { id: string; familyId: string }): Promise<void> {
  const member = await findInFamily(input.id, input.familyId);
  if (member.role === 'parent') {
    const actives = await db
      .select({ id: schema.persons.id })
      .from(schema.persons)
      .where(and(
        eq(schema.persons.familyId, input.familyId),
        eq(schema.persons.role, 'parent'),
        eq(schema.persons.active, true),
      ));
    const remaining = actives.filter((a) => a.id !== input.id);
    if (remaining.length === 0) throw new Error("You can't archive the only parent");
  }
  db.update(schema.persons).set({ active: false }).where(eq(schema.persons.id, input.id)).run();
}

export async function restoreMember(input: { id: string; familyId: string }): Promise<void> {
  await findInFamily(input.id, input.familyId);
  db.update(schema.persons).set({ active: true }).where(eq(schema.persons.id, input.id)).run();
}

export async function completeSetup(): Promise<void> {
  await setConfig('setup_completed', '1');
}
```

- [ ] **Step 4: Run the tests.**

Run: `npm test -- members`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/server/members.ts src/lib/server/members.test.ts
git commit -m "feat(members): members.ts CRUD + archive guard + completeSetup"
```

---

### Task 3: Active-filter the server-lib read paths

**Files:**
- Modify: `src/lib/server/family.ts` (`getKidSummaries`, ~lines 18-26)
- Modify: `src/lib/server/cheers.ts` (`listKidCheerPerms`, ~lines 19-27)
- Modify: `src/lib/server/payouts.ts` (`getCurrentWeekReview` kids query, ~lines 53-61)
- Modify: `src/lib/server/setup.ts` (`getOrInitOnlyFamily` parents/kids queries; `getFirstParent`)
- Test: `src/lib/server/members-filtering.test.ts`

**Interfaces:**
- Consumes: `schema.persons.active` (Task 1); `addKid`/`addParent`/`archiveMember` (Task 2, test only).
- Produces: archived members excluded from all of the above. No signature changes.

For each query below, add `eq(schema.persons.active, true)` as an additional argument to the existing `and(...)`. (`and`/`eq` are already imported in each of these files.)

- [ ] **Step 1: Write the failing tests.** Create `src/lib/server/members-filtering.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { seedFamily } from './test/seed';
import { addKid, addParent, archiveMember } from './members';
import { getKidSummaries } from './family';
import { listKidCheerPerms } from './cheers';
import { getCurrentWeekReview } from './payouts';
import { getOrInitOnlyFamily } from './setup';

describe('archived members are excluded from active views', () => {
  it('getKidSummaries omits an archived kid', async () => {
    const fam = seedFamily();
    const a = await addKid({ familyId: fam, name: 'A', birthdate: '2016-01-01' });
    const b = await addKid({ familyId: fam, name: 'B', birthdate: '2016-01-01' });
    await archiveMember({ id: b, familyId: fam });
    const ids = (await getKidSummaries(fam)).map((k) => k.id);
    expect(ids).toEqual([a]);
  });

  it('listKidCheerPerms omits an archived kid', async () => {
    const fam = seedFamily();
    const a = await addKid({ familyId: fam, name: 'A', birthdate: '2016-01-01' });
    const b = await addKid({ familyId: fam, name: 'B', birthdate: '2016-01-01' });
    await archiveMember({ id: b, familyId: fam });
    const ids = (await listKidCheerPerms(fam)).map((k) => k.id);
    expect(ids).toEqual([a]);
  });

  it('getCurrentWeekReview omits an archived kid', async () => {
    const fam = seedFamily();
    const a = await addKid({ familyId: fam, name: 'A', birthdate: '2016-01-01' });
    const b = await addKid({ familyId: fam, name: 'B', birthdate: '2016-01-01' });
    await archiveMember({ id: b, familyId: fam });
    const review = await getCurrentWeekReview(fam);
    expect(review.kids.map((k) => k.id)).toEqual([a]);
  });

  it('getOrInitOnlyFamily.hasKid is false when the only kid is archived', async () => {
    const fam = seedFamily();
    const k = await addKid({ familyId: fam, name: 'A', birthdate: '2016-01-01' });
    await addParent({ familyId: fam, name: 'Dad' });
    await archiveMember({ id: k, familyId: fam });
    const info = await getOrInitOnlyFamily();
    expect(info?.hasKid).toBe(false);
    expect(info?.hasParent).toBe(true);
  });
});
```

(Note: `getCurrentWeekReview` returns an object with a `kids` array of `{ id, ... }`; if its shape differs, read `payouts.ts` and adjust the assertion to the real field — the behavior under test is "archived kid absent.")

- [ ] **Step 2: Run to verify failure.**

Run: `npx svelte-kit sync && npm test -- members-filtering`
Expected: FAIL (archived kids still present).

- [ ] **Step 3: Add the filters.**
  - `family.ts` `getKidSummaries`: change the `.where(and(eq(...familyId...), eq(...role, 'kid')))` to also include `eq(schema.persons.active, true)`.
  - `cheers.ts` `listKidCheerPerms`: same addition to its `and(...)`.
  - `payouts.ts` `getCurrentWeekReview`: same addition to the kids `and(...)`.
  - `setup.ts` `getOrInitOnlyFamily`: add `eq(schema.persons.active, true)` to BOTH the `parents` and `kids` `and(...)` clauses.
  - `setup.ts` `getFirstParent`: add `eq(schema.persons.active, true)` to its `and(...)`.

Example (family.ts):

```ts
    .where(and(
      eq(schema.persons.familyId, familyId),
      eq(schema.persons.role, 'kid'),
      eq(schema.persons.active, true),
    ));
```

- [ ] **Step 4: Run the tests.**

Run: `npm test -- members-filtering`
Expected: PASS (4 tests).

- [ ] **Step 5: Full suite + typecheck.**

Run: `npm test && npm run check`
Expected: tests green; `npm run check` shows no NEW errors beyond the pre-existing baseline (the repo carries 8 known svelte-check errors in unrelated files).

- [ ] **Step 6: Commit.**

```bash
git add src/lib/server/family.ts src/lib/server/cheers.ts src/lib/server/payouts.ts src/lib/server/setup.ts src/lib/server/members-filtering.test.ts
git commit -m "feat(members): exclude archived members from server-lib read paths"
```

---

### Task 4: Active-filter the route-level kid queries

**Files (each has a kid/person `select` to filter):**
- Modify: `src/routes/claim/+page.server.ts:21-28` (ALL persons → active only; needs `eq` import)
- Modify: `src/routes/chores/+page.server.ts:18-25`
- Modify: `src/routes/chores/new/+page.server.ts:13-21`
- Modify: `src/routes/chores/[id]/+page.server.ts:22-30`
- Modify: `src/routes/settings/payouts/+page.server.ts:29-32`

**Interfaces:**
- Consumes: `schema.persons.active`.
- Produces: archived members no longer appear in the claim list, chore-assignment dropdowns, or the per-kid payout-override list.

These are SvelteKit `load` queries; they're verified by typecheck + build + a manual smoke (consistent with the spec's "manual read-through" for UI), since the archive-hiding contract is already unit-tested at the lib layer in Task 3.

- [ ] **Step 1: Edit `claim/+page.server.ts`.** The persons query currently has no `.where`. Add a filter and ensure `eq` is imported (`import { eq } from 'drizzle-orm';`):

```ts
  const persons = await db
    .select({
      id: schema.persons.id,
      familyId: schema.persons.familyId,
      name: schema.persons.name,
      role: schema.persons.role,
    })
    .from(schema.persons)
    .where(eq(schema.persons.active, true));
```

- [ ] **Step 2: Edit the four `role = 'kid'` dropdown/list queries** (`chores/+page`, `chores/new`, `chores/[id]`, `settings/payouts`). In each, add `eq(schema.persons.active, true)` to the existing `and(...)` of the kids query (the same one-line addition as Task 3). Confirm `and`/`eq` are imported in each file; add the import if missing.

- [ ] **Step 3: Typecheck + build.**

Run: `npx svelte-kit sync && npm run check && npm run build`
Expected: no new `npm run check` errors beyond the 8-error baseline; `npm run build` succeeds.

- [ ] **Step 4: Commit.**

```bash
git add src/routes/claim/+page.server.ts src/routes/chores/+page.server.ts src/routes/chores/new/+page.server.ts "src/routes/chores/[id]/+page.server.ts" src/routes/settings/payouts/+page.server.ts
git commit -m "feat(members): exclude archived members from claim + chore/payout route queries"
```

---

### Task 5: `MemberManager.svelte` + `/settings/members` route + Settings link

**Files:**
- Create: `src/lib/components/MemberManager.svelte`
- Create: `src/routes/settings/members/+page.server.ts`
- Create: `src/routes/settings/members/+page.svelte`
- Modify: `src/routes/settings/+page.svelte` (add a "Family members" card)

**Interfaces:**
- Consumes: `listMembers`, `addKid`, `addParent`, `editMember`, `archiveMember`, `restoreMember` (Task 2); `requireFreshPin` from `$lib/server/pinGuard`.
- Produces: `MemberManager` component with props `parents: MemberRow[]`, `kids: MemberRow[]`, `form` (action result). Reused by Task 6.

- [ ] **Step 1: Create the shared component `src/lib/components/MemberManager.svelte`.** Its forms post to the current route's actions (`?/...`), so the same component works under both surfaces:

```svelte
<script lang="ts">
  type Member = { id: string; name: string; birthdate?: string | null; active: boolean; hasPin?: boolean };
  export let parents: Member[];
  export let kids: Member[];
  export let form: { error?: string; ok?: boolean; message?: string } | null = null;
</script>

{#if form?.error}
  <p class="mt-3 rounded bg-red-100 p-3 text-red-800 text-sm">{form.error}</p>
{:else if form?.ok}
  <p class="mt-3 rounded bg-green-100 p-3 text-green-800 text-sm">{form.message}</p>
{/if}

<section class="mt-6 rounded-xl border border-slate-200 bg-white p-4">
  <h2 class="font-medium">Parents</h2>
  <ul class="mt-3 space-y-3">
    {#each parents as p (p.id)}
      <li class="flex items-center gap-2" class:opacity-50={!p.active}>
        <form method="POST" action="?/edit" class="flex flex-1 items-center gap-2">
          <input type="hidden" name="id" value={p.id} />
          <input name="name" value={p.name} required class="flex-1 rounded border border-slate-300 p-2 text-sm" />
          <button class="rounded bg-slate-200 hover:bg-slate-300 px-3 py-2 text-sm">Save</button>
        </form>
        {#if p.active}
          <form method="POST" action="?/archive">
            <input type="hidden" name="id" value={p.id} />
            <button class="rounded bg-slate-100 hover:bg-slate-200 px-3 py-2 text-sm text-slate-600">Archive</button>
          </form>
        {:else}
          <form method="POST" action="?/restore">
            <input type="hidden" name="id" value={p.id} />
            <button class="rounded bg-brand-100 hover:bg-brand-200 px-3 py-2 text-sm">Restore</button>
          </form>
        {/if}
      </li>
    {/each}
  </ul>
  <form method="POST" action="?/addParent" class="mt-4 flex gap-2">
    <input name="name" placeholder="Co-parent name" required class="flex-1 rounded border border-slate-300 p-2 text-sm" />
    <button class="rounded-lg bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 text-sm font-medium">Add co-parent</button>
  </form>
  <p class="mt-2 text-xs text-slate-500">They set their own PIN on their device after claiming it.</p>
</section>

<section class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
  <h2 class="font-medium">Kids</h2>
  <ul class="mt-3 space-y-3">
    {#each kids as k (k.id)}
      <li class="flex items-center gap-2" class:opacity-50={!k.active}>
        <form method="POST" action="?/edit" class="flex flex-1 items-center gap-2">
          <input type="hidden" name="id" value={k.id} />
          <input name="name" value={k.name} required class="flex-1 rounded border border-slate-300 p-2 text-sm" />
          <input name="birthdate" type="date" value={k.birthdate ?? ''} required class="rounded border border-slate-300 p-2 text-sm" />
          <button class="rounded bg-slate-200 hover:bg-slate-300 px-3 py-2 text-sm">Save</button>
        </form>
        {#if k.active}
          <form method="POST" action="?/archive">
            <input type="hidden" name="id" value={k.id} />
            <button class="rounded bg-slate-100 hover:bg-slate-200 px-3 py-2 text-sm text-slate-600">Archive</button>
          </form>
        {:else}
          <form method="POST" action="?/restore">
            <input type="hidden" name="id" value={k.id} />
            <button class="rounded bg-brand-100 hover:bg-brand-200 px-3 py-2 text-sm">Restore</button>
          </form>
        {/if}
      </li>
    {/each}
  </ul>
  <form method="POST" action="?/addKid" class="mt-4 flex gap-2">
    <input name="name" placeholder="Kid name" required class="flex-1 rounded border border-slate-300 p-2 text-sm" />
    <input name="birthdate" type="date" required class="rounded border border-slate-300 p-2 text-sm" />
    <button class="rounded-lg bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 text-sm font-medium">Add kid</button>
  </form>
</section>
```

- [ ] **Step 2: Create `src/routes/settings/members/+page.server.ts`** (parents-only + PIN gate, mirroring `/settings/payouts`):

```ts
import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import { requireFreshPin } from '$lib/server/pinGuard';
import { listMembers, addKid, addParent, editMember, archiveMember, restoreMember } from '$lib/server/members';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.session) throw redirect(303, '/claim');
  if (locals.session.role !== 'parent') throw error(403, 'Parents only');
  await requireFreshPin(locals.session, '/settings/members');
  return await listMembers(locals.session.familyId);
};

export const actions: Actions = {
  addKid: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') return fail(403, { error: 'Parents only' });
    const data = await request.formData();
    try {
      await addKid({ familyId: locals.session.familyId, name: data.get('name')?.toString() ?? '', birthdate: data.get('birthdate')?.toString() ?? '' });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Kid added.' };
  },
  addParent: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') return fail(403, { error: 'Parents only' });
    const data = await request.formData();
    try {
      await addParent({ familyId: locals.session.familyId, name: data.get('name')?.toString() ?? '' });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Co-parent added.' };
  },
  edit: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') return fail(403, { error: 'Parents only' });
    const data = await request.formData();
    const birthdate = data.get('birthdate')?.toString();
    try {
      await editMember({ id: data.get('id')?.toString() ?? '', familyId: locals.session.familyId, name: data.get('name')?.toString() ?? '', birthdate: birthdate || undefined });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Saved.' };
  },
  archive: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') return fail(403, { error: 'Parents only' });
    const data = await request.formData();
    try {
      await archiveMember({ id: data.get('id')?.toString() ?? '', familyId: locals.session.familyId });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Archived.' };
  },
  restore: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') return fail(403, { error: 'Parents only' });
    const data = await request.formData();
    try {
      await restoreMember({ id: data.get('id')?.toString() ?? '', familyId: locals.session.familyId });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Restored.' };
  },
};
```

- [ ] **Step 3: Create `src/routes/settings/members/+page.svelte`:**

```svelte
<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import MemberManager from '$lib/components/MemberManager.svelte';
  export let data: PageData;
  export let form: ActionData;
</script>

<svelte:head><title>Family members</title></svelte:head>

<header>
  <a href="/settings" class="text-sm text-slate-500 hover:text-slate-800">← Settings</a>
  <h1 class="text-2xl font-semibold mt-1">Family members</h1>
</header>

<MemberManager parents={data.parents} kids={data.kids} {form} />
```

- [ ] **Step 4: Add a "Family members" card to `src/routes/settings/+page.svelte`.** Immediately above the existing Payouts `<section>` (the one linking to `/settings/payouts`), insert:

```svelte
<section class="mt-6 rounded-xl border border-slate-200 bg-white p-4">
  <a href="/settings/members" class="flex items-center justify-between">
    <span class="font-medium">Family members</span>
    <span class="text-slate-400 text-sm">Add or edit kids &amp; co-parents →</span>
  </a>
</section>
```

(Change the Payouts section's `mt-6` to `mt-4` so spacing stays consistent, since it's no longer first.)

- [ ] **Step 5: Typecheck + build + manual smoke.**

Run: `npx svelte-kit sync && npm run check && npm run build`
Expected: no new check errors; build succeeds.
Manual (against the running prod container): Settings shows a "Family members" card → the page lists you (parent), lets you add a kid (name + birthdate) and a co-parent (name), edit a name, and Archive/Restore. Archiving the only parent shows the guard error.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/components/MemberManager.svelte src/routes/settings/members/ src/routes/settings/+page.svelte
git commit -m "feat(members): /settings/members screen + shared MemberManager component"
```

---

### Task 6: Make the wizard add members (rename `/setup/kids` → `/setup/members`, wire completion)

**Files:**
- Rename: `src/routes/setup/kids/+page.server.ts` → `src/routes/setup/members/+page.server.ts` (rewrite contents below)
- Rename: `src/routes/setup/kids/+page.svelte` → `src/routes/setup/members/+page.svelte` (rewrite contents below)
- Modify: `src/routes/setup/done/+page.server.ts` (call `completeSetup()` before claiming)
- Modify: `src/routes/setup/+page.server.ts:13`, `src/routes/setup/parent/+page.server.ts:12,20,51` (redirect `/setup/kids` → `/setup/members`)

**Interfaces:**
- Consumes: `MemberManager` (Task 5); `listMembers`, `addKid`, `addParent`, `editMember`, `archiveMember`, `restoreMember`, `completeSetup` (Task 2); `getOrInitOnlyFamily` (Task 3).
- Produces: a reachable wizard members step; `/setup/done` sets the completion marker.

- [ ] **Step 1: Create `src/routes/setup/members/+page.server.ts`** (no auth — runs pre-claim; gets the family via `getOrInitOnlyFamily`):

```ts
// Wizard step 3: add kids and co-parents. No session yet (pre-claim); the only
// family is resolved via getOrInitOnlyFamily. "Done" links to /setup/done.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getOrInitOnlyFamily } from '$lib/server/setup';
import { listMembers, addKid, addParent, editMember, archiveMember, restoreMember } from '$lib/server/members';

export const load: PageServerLoad = async () => {
  const fam = await getOrInitOnlyFamily();
  if (!fam) throw redirect(303, '/setup');
  if (!fam.hasParent) throw redirect(303, '/setup/parent');
  return await listMembers(fam.id);
};

async function requireFamilyId(): Promise<string> {
  const fam = await getOrInitOnlyFamily();
  if (!fam) throw redirect(303, '/setup');
  return fam.id;
}

export const actions: Actions = {
  addKid: async ({ request }) => {
    const familyId = await requireFamilyId();
    const data = await request.formData();
    try {
      await addKid({ familyId, name: data.get('name')?.toString() ?? '', birthdate: data.get('birthdate')?.toString() ?? '' });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Kid added.' };
  },
  addParent: async ({ request }) => {
    const familyId = await requireFamilyId();
    const data = await request.formData();
    try {
      await addParent({ familyId, name: data.get('name')?.toString() ?? '' });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Co-parent added.' };
  },
  edit: async ({ request }) => {
    const familyId = await requireFamilyId();
    const data = await request.formData();
    const birthdate = data.get('birthdate')?.toString();
    try {
      await editMember({ id: data.get('id')?.toString() ?? '', familyId, name: data.get('name')?.toString() ?? '', birthdate: birthdate || undefined });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Saved.' };
  },
  archive: async ({ request }) => {
    const familyId = await requireFamilyId();
    const data = await request.formData();
    try {
      await archiveMember({ id: data.get('id')?.toString() ?? '', familyId });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Archived.' };
  },
  restore: async ({ request }) => {
    const familyId = await requireFamilyId();
    const data = await request.formData();
    try {
      await restoreMember({ id: data.get('id')?.toString() ?? '', familyId });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Restored.' };
  },
};
```

- [ ] **Step 2: Create `src/routes/setup/members/+page.svelte`:**

```svelte
<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import MemberManager from '$lib/components/MemberManager.svelte';
  export let data: PageData;
  export let form: ActionData;
</script>

<svelte:head><title>Add your family</title></svelte:head>

<header>
  <h1 class="text-2xl font-semibold">Add your family</h1>
  <p class="mt-1 text-sm text-slate-500">Add your kids and any co-parents. You can change these later in Settings.</p>
</header>

<MemberManager parents={data.parents} kids={data.kids} {form} />

<a href="/setup/done" class="mt-6 block rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-3 text-center font-medium">
  Done
</a>
```

- [ ] **Step 3: Delete the old `src/routes/setup/kids/` directory** (both files) if the rename left it behind:

```bash
git rm src/routes/setup/kids/+page.server.ts src/routes/setup/kids/+page.svelte
```

- [ ] **Step 4: Wire completion into `src/routes/setup/done/+page.server.ts`.** Add the import and call `completeSetup()` immediately before the `claimDevice` call (so the marker is set before the redirect home):

```ts
import { completeSetup } from '$lib/server/members';
// ... inside load, after the `if (!parent) ...` guard and before claimDevice:
  await completeSetup();
```

- [ ] **Step 5: Update the redirect targets.** In `src/routes/setup/+page.server.ts` (line 13) and `src/routes/setup/parent/+page.server.ts` (lines 12, 20, 51), change every `'/setup/kids'` to `'/setup/members'`.

- [ ] **Step 6: Typecheck + build.**

Run: `npx svelte-kit sync && npm run check && npm run build`
Expected: no new check errors; build succeeds; no dangling import of the removed `/setup/kids`.

- [ ] **Step 7: Manual wizard walk-through** (on a FRESH DB — e.g. a throwaway `DATABASE_URL=./wizard-test.db node ./scripts/migrate.js` then run the built server against it, or a fresh Docker volume):
  Family name → first parent → **Add your family** step appears and accepts a kid + a co-parent → **Done** → lands on the home dashboard (claimed as the first parent). Confirm revisiting `/setup` now redirects home (marker set). Delete the throwaway DB afterward.

- [ ] **Step 8: Commit.**

```bash
git add src/routes/setup/
git commit -m "feat(members): wizard adds kids + co-parents; /setup/done records completion"
```

---

## Self-Review

**1. Spec coverage:**
- Component 1 (completion marker) → Task 1 (isSetupComplete rewrite + backfill) + Task 6 (completeSetup wired into /setup/done).
- Component 2 (migration 0004: `active` + backfill) → Task 1.
- Component 3 (`members.ts` module) → Task 2.
- Component 4 (active-filter pass) → Task 3 (libs) + Task 4 (routes).
- Component 5 (shared component + two surfaces + Settings link) → Task 5 (Settings) + Task 6 (wizard).
- Error handling (validation, last-parent guard, parents-only/PIN, cross-family not-found) → Task 2 (guard + family-scoped `findInFamily`), Task 5 (PIN gate + parents-only).
- Testing → Tasks 1-3 carry unit tests; Tasks 4-6 are UI verified by typecheck/build/manual per spec.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to". Every code step has full code. The one conditional note (getCurrentWeekReview shape) names the exact fallback action (read the file, assert absence).

**3. Type consistency:** `MemberRow` defined in Task 2 is consumed by the component (Task 5) via a structurally-identical local `Member` type. Action names (`addKid`/`addParent`/`edit`/`archive`/`restore`) match between the component's `action="?/..."` forms and both routes' `actions`. `editMember`/`archiveMember`/`restoreMember` take `{ id, familyId }` in Task 2 and are called that way in Tasks 5-6. `completeSetup()`/`isSetupComplete()` agree across Tasks 1, 2, 6.
