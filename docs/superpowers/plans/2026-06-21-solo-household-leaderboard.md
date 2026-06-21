# Solo-Household Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/leaderboard` always show the local household's kids ranked — with no scoreboard connection or rival required — and expand to the cross-home league (Cup + cheer wall) only once ≥2 households are on the board.

**Architecture:** The page's `load` already has all the pieces: `buildLocalSummary(familyId)` computes a household's kids fully locally, and `rankedKids()`/`houseCup()` are pure view helpers. We replace the "not connected → blank" early-return with a local-summary path, and gate the Cup + cheer wall on `houses.length >= 2`. The Svelte page renders standings unconditionally and shows an "add a rival" nudge when solo.

**Tech Stack:** SvelteKit (Svelte 4) + `adapter-node`, TypeScript, Vitest with the app's in-memory migrated-DB harness, Drizzle/SQLite.

**Reference spec:** `docs/superpowers/specs/2026-06-21-solo-household-leaderboard-design.md`

## Global Constraints

- **Svelte 4 / Vite 5 / Vitest 2 stack — do NOT upgrade any dependency.** (The app was deliberately kept off Svelte 5.)
- **No schema changes, no new dependencies, no worker changes.**
- **Do not add new `svelte-check` errors.** The app has a known baseline of **8 pre-existing** errors in unrelated files; `npm run check` must not exceed that count.
- **`npm run build` must still succeed** (adapter-node production build).
- Reuse the existing Vitest harness + seed helpers (`src/lib/server/test/seed.ts`); do not add new test infrastructure.
- The canonical "no rivals" signal is the boolean **`hasRivals` (`houses.length >= 2`)** returned by `load` — this realizes the spec's "solo mode" concept. Solo = `!hasRivals`.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/routes/leaderboard/+page.server.ts` | Load household/league board data; gate Cup + cheers on `hasRivals` | Modify `load` only (leave `actions` untouched) |
| `src/routes/leaderboard/+page.server.test.ts` | Verify solo-mode load returns local ranked kids, no Cup | Create |
| `src/routes/leaderboard/+page.svelte` | Render standings always; Cup + cheer wall only with rivals; solo nudge | Modify template |

---

## Task 1: Solo-mode load + `hasRivals` gating (server)

**Files:**
- Modify: `src/routes/leaderboard/+page.server.ts` (the `load` function only; do not change the `actions` block)
- Test: `src/routes/leaderboard/+page.server.test.ts` (create)

**Interfaces:**
- Consumes (all already exist):
  - `buildLocalSummary(familyId: string): Promise<{ house: string; weekStarting: string; kids: ViewKid[] }>` from `$lib/server/leaderboard`
  - `rankedKids(houses: ViewHouse[]): RankedKid[]`, `houseCup(houses: ViewHouse[]): CupResult | null`, and the `ViewHouse` type from `$lib/leaderboard-view`
  - `isConnected()`, `pushSummary(familyId)`, `getBoard()` from `$lib/server/scoreboard`
  - `canPostCheers(personId)` from `$lib/server/cheers`; `CHEER_PHRASES`, `phraseText` from `$lib/cheers`
  - Seed helpers `seedFamily`, `seedKid`, `seedChore`, `seedInstance` from `$lib/server/test/seed`; `isoDaysAgo`, `todayIso` from `$lib/server/dates`
- Produces — `load` now returns a single consistent shape:
  ```ts
  {
    connected: boolean;
    unreachable: boolean;
    ranked: RankedKid[];
    cup: CupResult | null;
    hasRivals: boolean;
    cheers: { fromHouse: string; fromName: string; avatar: string; phraseId: string; ts: number; text: string }[];
    viewerCanCheer: boolean;
    phrases: typeof CHEER_PHRASES;
  }
  ```

- [ ] **Step 1: Write the failing test** — create `src/routes/leaderboard/+page.server.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { load } from './+page.server';
import { todayIso } from '$lib/server/dates';
import { seedFamily, seedKid, seedChore, seedInstance } from '$lib/server/test/seed';

// Minimal RequestEvent stand-in: load only reads locals.session.
function ev(session: unknown) {
  return { locals: { session } } as unknown as Parameters<typeof load>[0];
}

describe('leaderboard load — solo household (no scoreboard connection)', () => {
  it('ranks the local kids, reports no rivals, and shows no Cup', async () => {
    const fam = seedFamily('Solo Fam');
    const amy = seedKid(fam, 'Amy');
    const ben = seedKid(fam, 'Ben');
    const amyChore = seedChore(fam, amy);
    const benChore1 = seedChore(fam, ben);
    const benChore2 = seedChore(fam, ben);
    const today = todayIso();
    // Amy: 1/1 confirmed = 100%. Ben: 1 confirmed + 1 pending = 50%. (today is always
    // inside the current responsibility week, so pct is deterministic regardless of weekday.)
    seedInstance(amyChore, today, 'confirmed');
    seedInstance(benChore1, today, 'confirmed');
    seedInstance(benChore2, today, 'pending');

    const data = await load(
      ev({ familyId: fam, role: 'parent', personId: 'parent-1', personName: 'Parent' })
    );

    expect(data.connected).toBe(false);
    expect(data.unreachable).toBe(false);
    expect(data.hasRivals).toBe(false);
    expect(data.cup).toBeNull();
    expect(data.cheers).toEqual([]);
    expect(data.ranked.map((k) => k.name)).toEqual(['Amy', 'Ben']); // 100% before 50%
    expect(data.ranked[0].rank).toBe(1);
    expect(data.ranked[0].house).toBe('Solo Fam');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- src/routes/leaderboard/+page.server.test.ts`
Expected: FAIL — the current `load` returns `{ connected: false }` with no `ranked`/`hasRivals`, so `data.ranked.map` throws / assertions fail.

- [ ] **Step 3: Rewrite the `load` function** in `src/routes/leaderboard/+page.server.ts`.

First, update the import block at the top of the file to add `buildLocalSummary` and the `ViewHouse` type (leave the other imports as they are):

```ts
import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { isConnected, pushSummary, getBoard, postCheer } from '$lib/server/scoreboard';
import { buildLocalSummary } from '$lib/server/leaderboard';
import { canPostCheers } from '$lib/server/cheers';
import { rankedKids, houseCup, type ViewHouse } from '$lib/leaderboard-view';
import { CHEER_PHRASES, phraseText } from '$lib/cheers';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';
```

Then replace the entire existing `export const load: PageServerLoad = async ({ locals }) => { ... };` block with:

```ts
export const load: PageServerLoad = async ({ locals }) => {
  const session = locals.session;
  if (!session) throw redirect(303, '/claim');

  const connected = await isConnected();

  let houses: ViewHouse[];
  let cheersRaw: { fromHouse: string; fromName: string; avatar: string; phraseId: string; ts: number }[] = [];

  if (connected) {
    try {
      await pushSummary(session.familyId);
    } catch (e) {
      console.error('[leaderboard] pushSummary failed (showing last-known):', e);
    }
    try {
      const board = await getBoard();
      houses = board.houses;
      cheersRaw = board.cheers;
    } catch (e) {
      console.error('[leaderboard] getBoard failed:', e);
      return {
        connected: true as const,
        unreachable: true as const,
        ranked: [],
        cup: null,
        hasRivals: false,
        cheers: [],
        viewerCanCheer: false,
        phrases: CHEER_PHRASES,
      };
    }
  } else {
    // Solo: build this household's own summary locally — no worker calls.
    houses = [await buildLocalSummary(session.familyId)];
  }

  const ranked = rankedKids(houses);
  const hasRivals = houses.length >= 2;
  const cup = hasRivals ? houseCup(houses) : null;

  const viewerCanCheer =
    hasRivals && session.role === 'kid' && (await canPostCheers(session.personId));

  const cheers = hasRivals
    ? cheersRaw.map((c) => ({ ...c, text: phraseText(c.phraseId) ?? c.phraseId })).reverse()
    : [];

  return {
    connected,
    unreachable: false as const,
    ranked,
    cup,
    hasRivals,
    cheers,
    viewerCanCheer,
    phrases: CHEER_PHRASES,
  };
};
```

Note: the `db`/`schema`/`eq` imports are still used by the `cheer` action below — keep them. The `load` no longer fetches the viewer avatar (the `cheer` action reads it from the DB itself at submit time), which is why `viewerName`/`viewerAvatar` are gone from the return; that's intentional and the template does not use them.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- src/routes/leaderboard/+page.server.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Run the full app test suite to confirm no regression**

Run: `npm test`
Expected: PASS — all previously-passing tests still green (the new test adds 1).

- [ ] **Step 6: Commit**

```bash
git add src/routes/leaderboard/+page.server.ts src/routes/leaderboard/+page.server.test.ts
git commit -m "feat(app): leaderboard works for a solo household (local standings, no rival required)"
```

---

## Task 2: Leaderboard page rendering (standings always, Cup/cheers gated, solo nudge)

**Files:**
- Modify: `src/routes/leaderboard/+page.svelte`

**Interfaces:**
- Consumes `PageData` from Task 1's `load`: `data.connected`, `data.unreachable`, `data.ranked`, `data.cup`, `data.hasRivals`, `data.cheers`, `data.viewerCanCheer`, `data.phrases`.
- Produces: no exports; presentational only.

This task has no unit test (the app has no Svelte component-test harness); it is verified by `svelte-check` (no new errors) and a successful production build. The rendering logic it depends on is already covered by Task 1's load test.

- [ ] **Step 1: Capture the current `svelte-check` baseline**

Run: `npm run check`
Expected: completes with the known **8 pre-existing errors** (in unrelated files). Note the exact count — Step 4 must not exceed it.

- [ ] **Step 2: Replace the body of `src/routes/leaderboard/+page.svelte`** (keep the `<script>` and `<header>`/`form?.error` blocks exactly as they are; replace everything from the first `{#if !data.connected}` through the final `{/if}` with this):

```svelte
{#if data.unreachable}
  <div class="mt-6 rounded-xl bg-amber-100 text-amber-900 p-4 text-sm text-center">
    Can't reach the scoreboard right now. Showing nothing until it's back.
  </div>
{:else}
  {#if data.connected}
    <div class="mt-4 flex justify-end">
      <form method="POST" action="?/refresh" use:enhance>
        <button class="text-sm text-slate-500 hover:text-slate-800 underline">Refresh</button>
      </form>
    </div>
  {/if}

  {#if data.cup}
    <div class="mt-5 rounded-2xl bg-brand-700 text-white p-4 text-center">
      <div class="text-xs uppercase tracking-wide opacity-80">🏆 Cup holder</div>
      <div class="text-2xl font-bold mt-1">{data.cup.house}</div>
      <div class="text-xs opacity-90 mt-1">{data.cup.avgPct}% house average</div>
    </div>
  {/if}

  <section class="mt-6">
    <h2 class="text-xs uppercase tracking-wide text-slate-500 font-medium">Standings</h2>
    <div class="mt-2 space-y-2">
      {#each data.ranked as k (k.house + k.name)}
        <div class="rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-3">
          <div class="w-6 text-center font-semibold text-slate-400">{k.rank}</div>
          <div class="text-2xl" aria-hidden="true">{k.avatar || '🙂'}</div>
          <div class="flex-1 min-w-0">
            <div class="font-medium truncate">{k.name}</div>
            <div class="text-xs text-slate-500 truncate">{k.house}</div>
          </div>
          <div class="text-right">
            <div class="font-semibold">{k.pct}%</div>
            <div class="text-xs text-slate-500">🔥 {k.streak}</div>
          </div>
        </div>
        {#if k.badges.length}
          <div class="-mt-1 ml-9 flex gap-1 flex-wrap">
            {#each k.badges as b}
              <span class="rounded-full bg-slate-100 text-slate-600 text-[10px] px-2 py-0.5">{b}</span>
            {/each}
          </div>
        {/if}
      {/each}
    </div>
  </section>

  {#if data.viewerCanCheer}
    <section class="mt-6">
      <h2 class="text-xs uppercase tracking-wide text-slate-500 font-medium">Send a cheer</h2>
      <div class="mt-2 flex flex-wrap gap-2">
        {#each data.phrases as p}
          <form method="POST" action="?/cheer" use:enhance>
            <input type="hidden" name="phraseId" value={p.id} />
            <button class="rounded-full border border-slate-200 bg-white hover:border-slate-400 text-sm px-3 py-1.5">
              {p.text}
            </button>
          </form>
        {/each}
      </div>
    </section>
  {/if}

  {#if data.hasRivals}
    <section class="mt-6">
      <h2 class="text-xs uppercase tracking-wide text-slate-500 font-medium">Cheer wall</h2>
      {#if data.cheers.length === 0}
        <p class="mt-2 text-sm text-slate-500">No cheers yet.</p>
      {:else}
        <div class="mt-2 space-y-1">
          {#each data.cheers as c (c.ts + c.fromName)}
            <div class="text-sm">
              <span aria-hidden="true">{c.avatar || '🙂'}</span>
              <span class="font-medium">{c.fromName}</span>
              <span class="text-slate-500">({c.fromHouse}):</span>
              {c.text}
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {:else}
    <div class="mt-6 rounded-xl border border-dashed border-slate-300 p-4 text-center text-slate-600">
      <p class="text-sm">
        Playing solo —
        <a href="/rivals" class="underline">🤝 add a rival household</a>
        to compete across homes.
      </p>
    </div>
  {/if}
{/if}
```

- [ ] **Step 3: Type-check / build to confirm no new errors**

Run: `npm run check`
Expected: error count is **the same baseline from Step 1 (8)** — no new errors introduced by the edit. (`data.cup` is guarded by `{#if data.cup}`; all referenced fields exist on the consistent load shape.)

- [ ] **Step 4: Confirm the production build still succeeds**

Run: `npm run build`
Expected: build completes, ending with `Using @sveltejs/adapter-node ✔ done`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/leaderboard/+page.svelte
git commit -m "feat(app): leaderboard UI — solo standings + 'add a rival' nudge; Cup/cheers only with rivals"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:**
  - "Always show local kids" → Task 1 solo path (`buildLocalSummary` → `rankedKids`) + Task 2 standings render unconditionally.
  - "Expand to league when ≥2 houses" → Task 1 `hasRivals`/`cup` gating; Task 2 Cup + cheer wall under `{#if data.cup}` / `{#if data.hasRivals}`.
  - "Cup hidden solo" → `cup = hasRivals ? houseCup(houses) : null` (Task 1) + `{#if data.cup}` (Task 2).
  - "Cheer wall hidden solo" → `cheers = hasRivals ? … : []` + `{#if data.hasRivals}` wall vs nudge (Task 2).
  - "Add-a-rival nudge" → Task 2 `{:else}` branch linking `/rivals`.
  - "No worker calls when solo" → Task 1 `else` branch calls only `buildLocalSummary`.
  - "Testing via in-memory harness" → Task 1 Step 1 load test using seed helpers.
- **Placeholder scan:** none — every step has complete code/commands.
- **Type consistency:** `load` returns one consistent shape across solo / connected / unreachable (same keys), so `PageData` is non-union and the template references only fields that always exist; `data.cup` (`CupResult | null`) is `{#if}`-guarded. `ViewHouse`/`RankedKid`/`CupResult` names match `leaderboard-view.ts`. Seed-helper and `buildLocalSummary` signatures match the existing code read during planning.
- **Scope:** two files + one test; no schema/worker/dependency changes — within Global Constraints.
