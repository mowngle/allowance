# Leaderboard App Integration — UI & Wiring Plan (2b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the user-facing half of the cross-home leaderboard — the `/leaderboard` page, the `/rivals` management page, the nightly summary push, and nav links — on top of the 2a backend.

**Architecture:** Pure additions to the existing SvelteKit app. Client-safe pure helpers (`cheers.ts`, `leaderboard-view.ts`) compute the ranked board + House Cup. A small server module (`server/cheers.ts`) gates per-kid cheer permission. Two new routes consume the 2a `scoreboard.ts` client. A nightly scheduler mirrors the existing `backup.ts` pattern. No existing behavior changes beyond added nav links.

**Tech Stack:** SvelteKit (form actions, `use:enhance`), Tailwind, Vitest (for the pure/server helpers).

**Reference spec:** `docs/superpowers/specs/2026-06-05-cross-home-leaderboard-design.md` (§6 Cup/badges, §7 cheers, §9 screen).
**Builds on:** `docs/superpowers/plans/2026-06-05-leaderboard-app-backend.md` (2a). The 2a client `src/lib/server/scoreboard.ts` exports: `isConnected()`, `registerHouse(url,name)`, `pushSummary(familyId)`, `getBoard()→Board`, `postCheer({fromName,avatar,phraseId})`, `listRequests()→PendingRequest[]`, `sendLinkRequest(friendCode)`, `approveLink(fromHouseId)`, `declineLink(fromHouseId)`, `leaveRival(houseId)`, `getOwnFriendCode()`. Types `Board`, `PendingRequest`.

---

## Context the implementer needs

- **Session:** `event.locals.session` = `{ personId, role, familyId, deviceId, personName } | null`. `data.session` is available in all pages via `src/routes/+layout.server.ts`.
- **Parent-only + PIN guard pattern** (from `src/routes/review/+page.server.ts`):
  ```ts
  if (!locals.session) throw redirect(303, '/claim');
  if (locals.session.role !== 'parent') throw error(403, 'Parents only');
  await requireFreshPin(locals.session, '/thispath');
  ```
  `requireFreshPin` is from `$lib/server/pinGuard`.
- **Form action pattern:** `export const actions = { name: async ({ locals, request }) => { ... return { ok:true } | fail(400,{error}) } }`. Pages use `<form method="POST" action="?/name" use:enhance>`.
- **UI conventions** (from home + settings pages): container is `max-w-2xl` (set by layout). Cards: `rounded-xl border border-slate-200 bg-white p-4`. Primary button: `rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-2 font-medium`. Secondary: `bg-slate-200 hover:bg-slate-300 text-slate-800`. Error/ok banners: `rounded bg-red-100 p-3 text-red-800 text-sm` / `bg-green-100 text-green-800`.
- **Board shape** (from `scoreboard.ts`): `{ houses: Array<{ houseId, house, weekStarting, kids: Array<{name,avatar,pct,streak,choresDone,badges}>, updatedAt }>, cheers: Array<{fromHouseId,fromHouse,fromName,avatar,phraseId,ts}> }`.
- **Do not import `$lib/server/*` into client (`.svelte`) code.** Pure view helpers live in `src/lib/` (not `src/lib/server/`).
- **Pre-existing svelte-check state:** the app currently has 8 unrelated svelte-check errors. The gate for UI tasks is "introduces **no new** errors," not "zero errors."

---

## File Structure

```
src/lib/
  cheers.ts                 # NEW: canned cheer phrase set (client-safe)
  cheers.test.ts            # NEW
  leaderboard-view.ts       # NEW: pure rankedKids() + houseCup() (client-safe)
  leaderboard-view.test.ts  # NEW
  server/
    cheers.ts               # NEW: per-kid cheer permission (canPostCheers/list/set)
    cheers.test.ts          # NEW
    scoreboard-sync.ts      # NEW: pushSummaryIfConnected() + nightly scheduler
    scoreboard-sync.test.ts # NEW
src/routes/
  leaderboard/+page.server.ts   # NEW
  leaderboard/+page.svelte      # NEW
  rivals/+page.server.ts        # NEW
  rivals/+page.svelte           # NEW
  +page.svelte                  # MODIFY: add Leaderboard nav link (kid + parent)
src/hooks.server.ts             # MODIFY: schedule nightly summary push
```

---

## Task 1: Cheer phrases + leaderboard view helpers (pure, client-safe)

**Files:**
- Create: `src/lib/cheers.ts`, `src/lib/cheers.test.ts`
- Create: `src/lib/leaderboard-view.ts`, `src/lib/leaderboard-view.test.ts`

- [ ] **Step 1: Write failing test `src/lib/cheers.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { CHEER_PHRASES, phraseText } from './cheers';

describe('cheers', () => {
  it('has unique non-empty ids and texts', () => {
    const ids = CHEER_PHRASES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CHEER_PHRASES.every((p) => p.id && p.text)).toBe(true);
  });

  it('phraseText looks up by id, null for unknown', () => {
    expect(phraseText(CHEER_PHRASES[0].id)).toBe(CHEER_PHRASES[0].text);
    expect(phraseText('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm fail** — `cd H:/dev/allowance && npm test -- cheers` → FAIL.

- [ ] **Step 3: Create `src/lib/cheers.ts`**

```ts
// Canned cross-home cheer phrases. Kids only ever PICK from this list (never type),
// so nothing unmoderatable leaves a house. Client-safe (no server imports).

export interface CheerPhrase {
  id: string;
  text: string;
}

export const CHEER_PHRASES: CheerPhrase[] = [
  { id: 'nice-streak', text: 'Nice streak! 🔥' },
  { id: 'catch-me', text: 'Catch me if you can 😎' },
  { id: 'gg', text: 'GG 👏' },
  { id: 'comeback', text: 'Comeback szn 📈' },
  { id: 'cup-coming', text: 'Cup is coming home 🏆' },
];

export function phraseText(id: string): string | null {
  return CHEER_PHRASES.find((p) => p.id === id)?.text ?? null;
}
```

- [ ] **Step 4: Write failing test `src/lib/leaderboard-view.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { rankedKids, houseCup, type ViewHouse } from './leaderboard-view';

const houses: ViewHouse[] = [
  {
    house: 'Smith',
    kids: [
      { name: 'Mia', avatar: '🦊', pct: 92, streak: 6, choresDone: 11, badges: [] },
      { name: 'Sam', avatar: '🐢', pct: 70, streak: 1, choresDone: 5, badges: [] },
    ],
  },
  {
    house: 'Jones',
    kids: [{ name: 'Leo', avatar: '🐻', pct: 92, streak: 9, choresDone: 8, badges: [] }],
  },
];

describe('rankedKids', () => {
  it('flattens all houses and ranks by pct, then streak', () => {
    const ranked = rankedKids(houses);
    expect(ranked.map((k) => k.name)).toEqual(['Leo', 'Mia', 'Sam']); // Leo & Mia tie 92%, Leo's streak 9 > 6
    expect(ranked[0].rank).toBe(1);
    expect(ranked[0].house).toBe('Jones');
    expect(ranked[2].rank).toBe(3);
  });
});

describe('houseCup', () => {
  it('returns the house with the highest average pct', () => {
    const cup = houseCup(houses);
    // Smith avg = (92+70)/2 = 81; Jones avg = 92 → Jones wins
    expect(cup?.house).toBe('Jones');
    expect(cup?.avgPct).toBe(92);
  });

  it('returns null for no houses', () => {
    expect(houseCup([])).toBeNull();
  });
});
```

- [ ] **Step 5: Run to confirm fail** — `cd H:/dev/allowance && npm test -- leaderboard-view` → FAIL.

- [ ] **Step 6: Create `src/lib/leaderboard-view.ts`**

```ts
// Pure, client-safe view helpers over a board's houses. No server imports — usable
// in both the page server load and the Svelte component.

export interface ViewKid {
  name: string;
  avatar: string;
  pct: number;
  streak: number;
  choresDone: number;
  badges: string[];
}

export interface ViewHouse {
  house: string;
  kids: ViewKid[];
}

export interface RankedKid extends ViewKid {
  house: string;
  rank: number;
}

export interface CupResult {
  house: string;
  avgPct: number;
}

/** All kids across the league, ranked by pct desc, then streak desc, then name. */
export function rankedKids(houses: ViewHouse[]): RankedKid[] {
  const flat = houses.flatMap((h) =>
    h.kids.map((k) => ({ ...k, house: h.house }))
  );
  flat.sort(
    (a, b) => b.pct - a.pct || b.streak - a.streak || a.name.localeCompare(b.name)
  );
  return flat.map((k, i) => ({ ...k, rank: i + 1 }));
}

/** The house holding the Cup on this viewer's board: highest average kid pct. */
export function houseCup(houses: ViewHouse[]): CupResult | null {
  if (houses.length === 0) return null;
  const scored = houses.map((h) => ({
    house: h.house,
    avgPct: h.kids.length
      ? Math.round(h.kids.reduce((s, k) => s + k.pct, 0) / h.kids.length)
      : 0,
  }));
  scored.sort((a, b) => b.avgPct - a.avgPct || a.house.localeCompare(b.house));
  return scored[0];
}
```

- [ ] **Step 7: Run both to confirm pass** — `cd H:/dev/allowance && npm test -- cheers leaderboard-view` → PASS (cheers 2 + view 3).

- [ ] **Step 8: Commit**

```bash
git -C H:/dev/allowance add src/lib/cheers.ts src/lib/cheers.test.ts src/lib/leaderboard-view.ts src/lib/leaderboard-view.test.ts
git -C H:/dev/allowance commit -m "feat(app): cheer phrases and pure leaderboard view helpers"
```

---

## Task 2: Per-kid cheer permission (server)

**Files:**
- Create: `src/lib/server/cheers.ts`, `src/lib/server/cheers.test.ts`

- [ ] **Step 1: Write failing test `src/lib/server/cheers.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { canPostCheers, listKidCheerPerms, setKidCheerPerm } from './cheers';
import { seedFamily, seedKid } from './test/seed';
import { db, schema } from './db';
import { eq } from 'drizzle-orm';

describe('cheer permissions', () => {
  it('defaults to false and flips with setKidCheerPerm', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    expect(await canPostCheers(kid)).toBe(false);
    await setKidCheerPerm(kid, true);
    expect(await canPostCheers(kid)).toBe(true);
    await setKidCheerPerm(kid, false);
    expect(await canPostCheers(kid)).toBe(false);
  });

  it('only kids can post (a parent id is always false)', async () => {
    const fam = seedFamily();
    const parentId = crypto.randomUUID();
    db.insert(schema.persons)
      .values({ id: parentId, familyId: fam, name: 'Dad', role: 'parent', createdAt: Date.now() })
      .run();
    await db
      .update(schema.persons)
      .set({ canPostCheers: true })
      .where(eq(schema.persons.id, parentId))
      .run();
    expect(await canPostCheers(parentId)).toBe(false); // role guard
  });

  it('lists kids with their permission flags', async () => {
    const fam = seedFamily();
    const a = seedKid(fam, 'Mia');
    const b = seedKid(fam, 'Sam');
    await setKidCheerPerm(a, true);
    const perms = await listKidCheerPerms(fam);
    expect(perms).toHaveLength(2);
    expect(perms.find((p) => p.id === a)?.canPostCheers).toBe(true);
    expect(perms.find((p) => p.id === b)?.canPostCheers).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm fail** — `cd H:/dev/allowance && npm test -- server/cheers` → FAIL.

- [ ] **Step 3: Create `src/lib/server/cheers.ts`**

```ts
// Per-kid permission to post canned cheers to the cross-home wall. Parent-managed,
// default off (see persons.can_post_cheers).

import { and, eq } from 'drizzle-orm';
import { db, schema } from './db';

export async function canPostCheers(personId: string): Promise<boolean> {
  const rows = await db
    .select({ role: schema.persons.role, canPostCheers: schema.persons.canPostCheers })
    .from(schema.persons)
    .where(eq(schema.persons.id, personId))
    .limit(1);
  const r = rows[0];
  return r?.role === 'kid' && !!r.canPostCheers;
}

export type KidCheerPerm = { id: string; name: string; canPostCheers: boolean };

export async function listKidCheerPerms(familyId: string): Promise<KidCheerPerm[]> {
  const rows = await db
    .select({
      id: schema.persons.id,
      name: schema.persons.name,
      canPostCheers: schema.persons.canPostCheers,
    })
    .from(schema.persons)
    .where(and(eq(schema.persons.familyId, familyId), eq(schema.persons.role, 'kid')));
  return rows.map((r) => ({ id: r.id, name: r.name, canPostCheers: !!r.canPostCheers }));
}

export async function setKidCheerPerm(personId: string, allowed: boolean): Promise<void> {
  db.update(schema.persons)
    .set({ canPostCheers: allowed })
    .where(eq(schema.persons.id, personId))
    .run();
}
```

- [ ] **Step 4: Run to confirm pass** — `cd H:/dev/allowance && npm test -- server/cheers` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git -C H:/dev/allowance add src/lib/server/cheers.ts src/lib/server/cheers.test.ts
git -C H:/dev/allowance commit -m "feat(app): per-kid cheer permission module"
```

---

## Task 3: Nightly summary push + scheduler

**Files:**
- Create: `src/lib/server/scoreboard-sync.ts`, `src/lib/server/scoreboard-sync.test.ts`
- Modify: `src/hooks.server.ts`

- [ ] **Step 1: Write failing test `src/lib/server/scoreboard-sync.test.ts`**

```ts
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
```

Note: `pushSummaryIfConnected` finds the local family via `getOrInitOnlyFamily()` (from `setup.ts`), which returns the single family in the DB — fine for a self-hosted single-family instance.

- [ ] **Step 2: Run to confirm fail** — `cd H:/dev/allowance && npm test -- scoreboard-sync` → FAIL.

- [ ] **Step 3: Create `src/lib/server/scoreboard-sync.ts`**

```ts
// Nightly push of this house's leaderboard summary to the Scoreboard Worker.
// Mirrors backup.ts's globalThis-guarded scheduler so SvelteKit hot-reload doesn't
// create duplicate timers. No-op when not connected to a scoreboard.

import { isConnected, pushSummary } from './scoreboard';
import { getOrInitOnlyFamily } from './setup';

/** Push the local family's summary if connected. Returns true if a push happened. */
export async function pushSummaryIfConnected(): Promise<boolean> {
  if (!(await isConnected())) return false;
  const fam = await getOrInitOnlyFamily();
  if (!fam) return false;
  try {
    await pushSummary(fam.id);
    return true;
  } catch (e) {
    console.error('[scoreboard-sync] push failed:', e);
    return false;
  }
}

// ─── Scheduler (mirrors backup.ts) ───────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __allowanceSummaryScheduler__: { timer: NodeJS.Timeout | null } | undefined;
}

function msUntilNext(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function scheduleNightlySummaryPush(): void {
  const existing = (globalThis as any).__allowanceSummaryScheduler__;
  if (existing?.timer) clearTimeout(existing.timer);
  const state = { timer: null as NodeJS.Timeout | null };
  (globalThis as any).__allowanceSummaryScheduler__ = state;

  function arm() {
    // 3:30am — just after the nightly backup at 3am.
    state.timer = setTimeout(async () => {
      try {
        const pushed = await pushSummaryIfConnected();
        if (pushed) console.log('[scoreboard-sync] nightly summary pushed');
      } catch (e) {
        console.error('[scoreboard-sync] nightly push errored:', e);
      }
      arm();
    }, msUntilNext(3) + 30 * 60 * 1000);
  }
  arm();
  console.log('[scoreboard-sync] scheduler armed');
}
```

- [ ] **Step 4: Run to confirm pass** — `cd H:/dev/allowance && npm test -- scoreboard-sync` → PASS (2 tests).

- [ ] **Step 5: Wire the scheduler into `src/hooks.server.ts`**

Add the import next to the existing ones and call it alongside `scheduleNightlyBackup()`:

```ts
import { scheduleNightlySummaryPush } from '$lib/server/scoreboard-sync';
```
and in the boot-time block (after `scheduleNightlyBackup();`):
```ts
scheduleNightlySummaryPush();
```

- [ ] **Step 6: Verify the app still boots / type-checks the new file**

Run: `cd H:/dev/allowance && npm test` → all green. Run `cd H:/dev/allowance && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "scoreboard-sync|hooks.server"` → expect NO output (no new errors in these files).

- [ ] **Step 7: Commit**

```bash
git -C H:/dev/allowance add src/lib/server/scoreboard-sync.ts src/lib/server/scoreboard-sync.test.ts src/hooks.server.ts
git -C H:/dev/allowance commit -m "feat(app): nightly summary push scheduler"
```

---

## Task 4: `/leaderboard` route

The board page. Visible to BOTH parent and kid. On load it best-effort pushes the
local summary (so the board reflects fresh local numbers), then fetches the league
board and computes the ranked list + Cup. Permitted kids can post a cheer.

**Files:**
- Create: `src/routes/leaderboard/+page.server.ts`
- Create: `src/routes/leaderboard/+page.svelte`

- [ ] **Step 1: Create `src/routes/leaderboard/+page.server.ts`**

```ts
// /leaderboard — visible to parent and kid. Shows the cross-home league board.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import {
  isConnected,
  pushSummary,
  getBoard,
  postCheer,
} from '$lib/server/scoreboard';
import { canPostCheers } from '$lib/server/cheers';
import { rankedKids, houseCup } from '$lib/leaderboard-view';
import { CHEER_PHRASES, phraseText } from '$lib/cheers';
import { db, schema } from '$lib/server/db';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
  const session = locals.session;
  if (!session) throw redirect(303, '/claim');

  if (!(await isConnected())) {
    return { connected: false as const };
  }

  // Best-effort: refresh our own numbers before reading the board.
  try {
    await pushSummary(session.familyId);
  } catch (e) {
    console.error('[leaderboard] pushSummary failed (showing last-known):', e);
  }

  let board;
  try {
    board = await getBoard();
  } catch (e) {
    console.error('[leaderboard] getBoard failed:', e);
    return { connected: true as const, unreachable: true as const };
  }

  const ranked = rankedKids(board.houses);
  const cup = houseCup(board.houses);

  // Can the current viewer (if a kid) post cheers, and as whom?
  const viewerCanCheer = session.role === 'kid' && (await canPostCheers(session.personId));
  let viewerAvatar = '';
  if (viewerCanCheer) {
    const rows = await db
      .select({ avatarUrl: schema.persons.avatarUrl })
      .from(schema.persons)
      .where(eq(schema.persons.id, session.personId))
      .limit(1);
    viewerAvatar = rows[0]?.avatarUrl ?? '';
  }

  const cheers = board.cheers
    .map((c) => ({ ...c, text: phraseText(c.phraseId) ?? c.phraseId }))
    .reverse(); // newest first for display

  return {
    connected: true as const,
    unreachable: false as const,
    ranked,
    cup,
    cheers,
    viewerCanCheer,
    viewerName: session.personName,
    viewerAvatar,
    phrases: CHEER_PHRASES,
  };
};

export const actions: Actions = {
  cheer: async ({ locals, request }) => {
    const session = locals.session;
    if (!session || session.role !== 'kid') return fail(403, { error: 'Not allowed.' });
    if (!(await canPostCheers(session.personId))) {
      return fail(403, { error: 'Cheers are turned off for you.' });
    }
    const data = await request.formData();
    const phraseId = data.get('phraseId')?.toString() ?? '';
    if (!phraseText(phraseId)) return fail(400, { error: 'Unknown cheer.' });

    const rows = await db
      .select({ avatarUrl: schema.persons.avatarUrl })
      .from(schema.persons)
      .where(eq(schema.persons.id, session.personId))
      .limit(1);
    try {
      await postCheer({
        fromName: session.personName,
        avatar: rows[0]?.avatarUrl ?? '',
        phraseId,
      });
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { ok: true };
  },

  refresh: async ({ locals }) => {
    // Re-push so the next load shows the freshest local numbers.
    const session = locals.session;
    if (!session) return fail(403, { error: 'Not allowed.' });
    try {
      await pushSummary(session.familyId);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { ok: true };
  },
};
```

- [ ] **Step 2: Create `src/routes/leaderboard/+page.svelte`**

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  export let data: PageData;
  export let form: ActionData;
</script>

<svelte:head><title>Leaderboard</title></svelte:head>

<header class="flex items-center justify-between">
  <a href="/" class="text-sm text-slate-500 hover:text-slate-800">← Home</a>
  <h1 class="text-xl font-semibold">Leaderboard</h1>
  <form method="POST" action="?/refresh" use:enhance>
    <button class="text-sm text-slate-500 hover:text-slate-800 underline">Refresh</button>
  </form>
</header>

{#if form?.error}
  <p class="mt-3 rounded bg-red-100 p-3 text-red-800 text-sm">{form.error}</p>
{/if}

{#if !data.connected}
  <div class="mt-6 rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-600">
    <p class="font-medium">Not connected to a scoreboard yet.</p>
    <p class="mt-1 text-sm">A parent can connect on the <a href="/rivals" class="underline">Rivals</a> page.</p>
  </div>
{:else if data.unreachable}
  <div class="mt-6 rounded-xl bg-amber-100 text-amber-900 p-4 text-sm text-center">
    Can't reach the scoreboard right now. Showing nothing until it's back.
  </div>
{:else}
  <!-- House Cup banner -->
  {#if data.cup}
    <div class="mt-5 rounded-2xl bg-brand-700 text-white p-4 text-center">
      <div class="text-xs uppercase tracking-wide opacity-80">🏆 Cup holder</div>
      <div class="text-2xl font-bold mt-1">{data.cup.house}</div>
      <div class="text-xs opacity-90 mt-1">{data.cup.avgPct}% house average</div>
    </div>
  {/if}

  <!-- Standings -->
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

  <!-- Post a cheer (permitted kids only) -->
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

  <!-- Cheer wall -->
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
{/if}
```

- [ ] **Step 3: Type-check the new route (no new svelte-check errors)**

Run: `cd H:/dev/allowance && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "routes/leaderboard"`
Expected: NO output (the new files add no errors). If output appears, fix it.

- [ ] **Step 4: Commit**

```bash
git -C H:/dev/allowance add src/routes/leaderboard/
git -C H:/dev/allowance commit -m "feat(app): /leaderboard page — Cup, standings, cheer wall"
```

---

## Task 5: `/rivals` route — connect + manage rivals + cheer toggles

Parent-only, PIN-gated. Three concerns on one page: connect this house to a
scoreboard, manage rivalries (own friend code, send/approve/decline requests, leave),
and toggle each kid's cheer permission.

**Files:**
- Create: `src/routes/rivals/+page.server.ts`
- Create: `src/routes/rivals/+page.svelte`

- [ ] **Step 1: Create `src/routes/rivals/+page.server.ts`**

```ts
// /rivals — parent-only, PIN-gated. Connect to a scoreboard, manage rivalries,
// and set per-kid cheer permissions.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import { requireFreshPin } from '$lib/server/pinGuard';
import {
  isConnected,
  registerHouse,
  getOwnFriendCode,
  getBoard,
  listRequests,
  sendLinkRequest,
  approveLink,
  declineLink,
  leaveRival,
} from '$lib/server/scoreboard';
import { listKidCheerPerms, setKidCheerPerm } from '$lib/server/cheers';
import { getConfig } from '$lib/server/config';

export const load: PageServerLoad = async ({ locals }) => {
  const session = locals.session;
  if (!session) throw redirect(303, '/claim');
  if (session.role !== 'parent') throw error(403, 'Parents only');
  await requireFreshPin(session, '/rivals');

  const connected = await isConnected();
  const kidPerms = await listKidCheerPerms(session.familyId);

  if (!connected) {
    return { connected: false as const, kidPerms };
  }

  const [friendCode, houseName] = await Promise.all([
    getOwnFriendCode(),
    getConfig('scoreboard_house_name'),
  ]);

  // Requests + current rivals — best-effort (scoreboard may be unreachable).
  let requests: Array<{ fromHouseId: string; fromName: string; ts: number }> = [];
  let rivals: Array<{ houseId: string; house: string }> = [];
  let ownHouseId = await getConfig('scoreboard_house_id');
  try {
    requests = await listRequests();
    const board = await getBoard();
    rivals = board.houses
      .filter((h) => h.houseId !== ownHouseId)
      .map((h) => ({ houseId: h.houseId, house: h.house }));
  } catch (e) {
    console.error('[rivals] scoreboard read failed:', e);
  }

  return {
    connected: true as const,
    friendCode,
    houseName,
    requests,
    rivals,
    kidPerms,
  };
};

function requireParent(locals: App.Locals) {
  if (!locals.session || locals.session.role !== 'parent') {
    return fail(403, { error: 'Parents only' });
  }
  return null;
}

export const actions: Actions = {
  connect: async ({ locals, request }) => {
    const bad = requireParent(locals);
    if (bad) return bad;
    const data = await request.formData();
    const url = data.get('url')?.toString().trim() ?? '';
    const name = data.get('houseName')?.toString().trim() ?? '';
    if (!url || !name) return fail(400, { error: 'URL and house name are required.' });
    try {
      const out = await registerHouse(url, name);
      return { ok: true, message: `Connected. Your friend code is ${out.friendCode}.` };
    } catch (e) {
      return fail(400, { error: `Could not connect: ${(e as Error).message}` });
    }
  },

  request: async ({ locals, request }) => {
    const bad = requireParent(locals);
    if (bad) return bad;
    const code = (await request.formData()).get('friendCode')?.toString().trim() ?? '';
    if (!code) return fail(400, { error: 'Enter a friend code.' });
    try {
      await sendLinkRequest(code);
      return { ok: true, message: 'Request sent. They need to approve it.' };
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },

  approve: async ({ locals, request }) => {
    const bad = requireParent(locals);
    if (bad) return bad;
    const id = (await request.formData()).get('fromHouseId')?.toString() ?? '';
    if (!id) return fail(400, { error: 'Missing house.' });
    try {
      await approveLink(id);
      return { ok: true, message: 'Linked!' };
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },

  decline: async ({ locals, request }) => {
    const bad = requireParent(locals);
    if (bad) return bad;
    const id = (await request.formData()).get('fromHouseId')?.toString() ?? '';
    if (!id) return fail(400, { error: 'Missing house.' });
    try {
      await declineLink(id);
      return { ok: true };
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },

  leave: async ({ locals, request }) => {
    const bad = requireParent(locals);
    if (bad) return bad;
    const id = (await request.formData()).get('houseId')?.toString() ?? '';
    if (!id) return fail(400, { error: 'Missing house.' });
    try {
      await leaveRival(id);
      return { ok: true, message: 'Rivalry ended.' };
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },

  setCheer: async ({ locals, request }) => {
    const bad = requireParent(locals);
    if (bad) return bad;
    const data = await request.formData();
    const kidId = data.get('kidId')?.toString() ?? '';
    const allowed = data.get('allowed')?.toString() === 'on';
    if (!kidId) return fail(400, { error: 'Missing kid.' });
    await setKidCheerPerm(kidId, allowed);
    return { ok: true };
  },
};
```

- [ ] **Step 2: Create `src/routes/rivals/+page.svelte`**

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  export let data: PageData;
  export let form: ActionData;
</script>

<svelte:head><title>Rivals</title></svelte:head>

<header>
  <a href="/" class="text-sm text-slate-500 hover:text-slate-800">← Home</a>
  <h1 class="text-2xl font-semibold mt-1">Rivals</h1>
</header>

{#if form?.error}
  <p class="mt-3 rounded bg-red-100 p-3 text-red-800 text-sm">{form.error}</p>
{:else if form?.ok && form?.message}
  <p class="mt-3 rounded bg-green-100 p-3 text-green-800 text-sm">{form.message}</p>
{/if}

{#if !data.connected}
  <!-- Connect -->
  <section class="mt-6 rounded-xl border border-slate-200 bg-white p-4">
    <h2 class="font-medium">Connect to a scoreboard</h2>
    <p class="text-xs text-slate-500 mt-1">
      Enter the scoreboard service URL and a name for your house. You'll get a friend
      code to share with other families.
    </p>
    <form method="POST" action="?/connect" use:enhance class="mt-3 space-y-3">
      <input name="url" placeholder="https://…workers.dev" required
        class="block w-full rounded border-slate-300 border p-2 text-sm" />
      <input name="houseName" placeholder="House name (e.g. Smith)" required
        class="block w-full rounded border-slate-300 border p-2 text-sm" />
      <button class="w-full rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-2 font-medium">
        Connect
      </button>
    </form>
  </section>
{:else}
  <!-- Your friend code -->
  <section class="mt-6 rounded-xl border border-slate-200 bg-white p-4">
    <h2 class="font-medium">Your friend code</h2>
    <p class="text-xs text-slate-500 mt-1">Share this with families you want to compete with.</p>
    <div class="mt-2 text-2xl font-mono tracking-widest">{data.friendCode}</div>
    <div class="text-xs text-slate-500 mt-1">House: {data.houseName}</div>
  </section>

  <!-- Add a rival -->
  <section class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
    <h2 class="font-medium">Add a rival</h2>
    <form method="POST" action="?/request" use:enhance class="mt-3 flex gap-2">
      <input name="friendCode" placeholder="THEIR-CODE" required
        class="flex-1 rounded border-slate-300 border p-2 text-sm font-mono" />
      <button class="rounded-lg bg-brand-700 hover:bg-brand-800 text-white px-4 text-sm font-medium">
        Request
      </button>
    </form>
  </section>

  <!-- Incoming requests -->
  {#if data.requests.length}
    <section class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 class="font-medium">Requests</h2>
      <div class="mt-2 space-y-2">
        {#each data.requests as r (r.fromHouseId)}
          <div class="flex items-center gap-2">
            <div class="flex-1 text-sm font-medium">{r.fromName}</div>
            <form method="POST" action="?/approve" use:enhance>
              <input type="hidden" name="fromHouseId" value={r.fromHouseId} />
              <button class="rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-1.5">Approve</button>
            </form>
            <form method="POST" action="?/decline" use:enhance>
              <input type="hidden" name="fromHouseId" value={r.fromHouseId} />
              <button class="rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm px-3 py-1.5">Decline</button>
            </form>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Current rivals -->
  {#if data.rivals.length}
    <section class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 class="font-medium">Current rivals</h2>
      <div class="mt-2 space-y-2">
        {#each data.rivals as rv (rv.houseId)}
          <div class="flex items-center gap-2">
            <div class="flex-1 text-sm font-medium">{rv.house}</div>
            <form method="POST" action="?/leave" use:enhance>
              <input type="hidden" name="houseId" value={rv.houseId} />
              <button class="rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm px-3 py-1.5">Leave</button>
            </form>
          </div>
        {/each}
      </div>
    </section>
  {/if}
{/if}

<!-- Per-kid cheer permission (always available to parents) -->
<section class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
  <h2 class="font-medium">Who can post cheers</h2>
  <p class="text-xs text-slate-500 mt-1">Let a kid send canned cheers to the wall. Off by default.</p>
  <div class="mt-3 space-y-2">
    {#each data.kidPerms as kid (kid.id)}
      <form method="POST" action="?/setCheer" use:enhance class="flex items-center justify-between">
        <span class="text-sm font-medium">{kid.name}</span>
        <span class="flex items-center gap-2">
          <input type="hidden" name="kidId" value={kid.id} />
          <input type="checkbox" name="allowed" checked={kid.canPostCheers}
            on:change={(e) => e.currentTarget.form?.requestSubmit()} />
          <span class="text-xs text-slate-500">{kid.canPostCheers ? 'On' : 'Off'}</span>
        </span>
      </form>
    {/each}
  </div>
</section>
```

- [ ] **Step 3: Type-check (no new svelte-check errors)**

Run: `cd H:/dev/allowance && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E "routes/rivals"`
Expected: NO output. Fix any errors that appear.

- [ ] **Step 4: Commit**

```bash
git -C H:/dev/allowance add src/routes/rivals/
git -C H:/dev/allowance commit -m "feat(app): /rivals page — connect, manage rivals, cheer toggles"
```

---

## Task 6: Nav links + manual verification

**Files:**
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Add a Leaderboard link for kids**

In `src/routes/+page.svelte`, inside the kid branch (`{#if session.role === 'kid' ...}`), after the "Today's chores" `</section>`, add:

```svelte
  <a href="/leaderboard" class="mt-6 block rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-center py-3 font-medium">
    🏆 Leaderboard →
  </a>
```

- [ ] **Step 2: Add Leaderboard + Rivals links for parents**

In the parent branch, the existing "Quick links" grid has two links (`/review`, `/chores`). Add two more links after the `/chores` link, INSIDE the same `grid grid-cols-2` div:

```svelte
    <a href="/leaderboard" class="rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-center py-3 font-medium">
      🏆 Leaderboard →
    </a>
    <a href="/rivals" class="rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-center py-3 font-medium">
      Rivals →
    </a>
```

- [ ] **Step 3: Full test + type-check gate**

Run: `cd H:/dev/allowance && npm test` → all app tests green (smoke 2 + config 4 + leaderboard 8 + scoreboard 8 + cheers 2 + view 3 + server/cheers 3 + scoreboard-sync 2 = 32).
Run: `cd H:/dev/allowance && npm run check 2>&1 | tail -3` → confirm the error count is STILL 8 (the pre-existing ones) — i.e. this plan added zero new svelte-check errors.

- [ ] **Step 4: Manual verification (use the `run` or `verify` skill)**

Start the app (`npm run dev`) and confirm, as a logged-in user:
1. Home shows a "🏆 Leaderboard" link (both kid and parent).
2. `/leaderboard` with no scoreboard configured shows the "Not connected" state linking to `/rivals`.
3. `/rivals` (parent, after PIN) shows the "Connect to a scoreboard" form and the per-kid cheer toggles.
4. (If a deployed Worker URL is available) connecting shows a friend code; the leaderboard then renders the Cup banner + your own house's kids.

Capture a screenshot of `/leaderboard` (connected, if possible) for the record.

- [ ] **Step 5: Commit**

```bash
git -C H:/dev/allowance add src/routes/+page.svelte
git -C H:/dev/allowance commit -m "feat(app): leaderboard + rivals nav links"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** §9 leaderboard screen → Task 4 (Cup banner, standings, cheer wall). §6 per-viewer House Cup → `houseCup()` (Task 1), rendered in Task 4. §7 cheer wall (canned, per-kid permission default off) → `cheers.ts` (Task 1) + `server/cheers.ts` (Task 2) + cheer action (Task 4) + toggles (Task 5). Friend-Code pairing UI (§5) → Task 5 (connect, request, approve/decline, leave). Nightly sync (§8) → Task 3. Nav → Task 6.
- **Placeholders:** none — every step has complete code or an exact command. UI tasks (4–6) gate on "no new svelte-check errors" + manual verification, since Svelte pages aren't unit-tested.
- **Type consistency:** `ViewHouse`/`ViewKid` (Task 1) are structurally compatible with `Board.houses[]`/kid (2a `scoreboard.ts`), so `rankedKids(board.houses)`/`houseCup(board.houses)` type-check. `phraseId` round-trips through `CHEER_PHRASES` (Task 1) on both post (Task 4 action) and display (Task 4 load). `canPostCheers` (Task 2) gates both the load flag and the cheer action.
- **Boundaries:** pure view logic in `src/lib` (client-safe, unit-tested); DB/permission logic in `src/lib/server`; routes only orchestrate. No `$lib/server` import reaches a `.svelte` file.
- **Deferred (unchanged from 2a):** Comeback-Kid badge (needs week-over-week history); free-text cheers; power-ups; seasons.

## After this plan
The feature is code-complete. Remaining real-world step: deploy the Worker (worker plan Task 9, needs the Cloudflare account), then connect each home via `/rivals` using the deployed URL.
