# Solo-Household Leaderboard — Design Spec

**Date:** 2026-06-21
**Status:** Approved design, pre-implementation
**Context:** The `/leaderboard` page currently shows nothing useful until the household
connects to the Cloudflare scoreboard and links a rival — it returns `{ connected: false }`
and renders a "go connect" state. But all scoring is computed locally
(`buildLocalSummary`, `rankedKids`, `houseCup`), so a single household's own kids can be
ranked with no worker or rival involved. This makes the leaderboard useful out of the box
and reframes the cross-home rivalry as an optional expansion.

Builds on the cross-home leaderboard feature: see
`docs/superpowers/specs/2026-06-05-cross-home-leaderboard-design.md`.

---

## Goal & Non-Goals

### Goal
- The leaderboard **always** shows the local household's kids ranked, with no dependency
  on the scoreboard connection or any rival.
- When the household has connected and linked rivals, the page **expands** to the full
  cross-home league exactly as today (no regression).

### Non-Goals
- No change to scoring math, the worker, or the `/rivals` connect/link flow.
- No intra-household cheer wall in solo mode (cheers stay a cross-home feature).
- No new persistence or schema changes.

---

## Behavior

- **Solo (no rivals / not connected):** render the local household's kids ranked by
  consistency % with streak as tiebreaker, plus their badges — computed locally, **no
  worker calls**.
- **Linked (≥2 households on the board):** unchanged from today — rivals' kids merge in,
  House Cup shows, cheer wall shows.

### What appears in solo mode
| Element | Solo (1 house) | Linked (≥2 houses) |
|---|---|---|
| Ranked kid standings | ✅ shown | ✅ shown |
| House Cup banner | ❌ hidden | ✅ shown |
| Cheer wall | ❌ hidden | ✅ shown |
| "🤝 Add a rival household" nudge → `/rivals` | ✅ shown | — |

The Cup and cheer wall are gated on **`houses.length >= 2`**, which uniformly covers both
"not connected" and "connected but no rivals yet."

---

## Implementation Shape

Small, reuses existing units. Two files + a test.

### `src/routes/leaderboard/+page.server.ts`
- Replace the early `if (!(await isConnected())) return { connected: false }` with a
  **local-summary path**: build `buildLocalSummary(session.familyId)`, wrap it as a
  single-element houses array, run the existing `rankedKids([summary])`, and return
  `{ connected: false, soloMode: true, ranked }`. No `pushSummary`/`getBoard` calls.
- The connected path is unchanged, but the page now treats "≥2 houses" as the trigger for
  Cup + cheers rather than "connected".
- `buildLocalSummary` is already exported from `$lib/server/scoreboard.ts` and returns the
  same `{ house, kids[] }` shape the board uses, so `rankedKids`/`houseCup` consume it
  directly.

### `src/routes/leaderboard/+page.svelte`
- Render `ranked` standings whenever present (both modes).
- Gate the **House Cup** and **cheer wall** blocks on `houses.length >= 2` (derive a
  `hasRivals` boolean).
- Show the **"Add a rival household"** nudge linking to `/rivals` when there are no rivals.

### Data flow
```
solo:   load → buildLocalSummary(familyId) → rankedKids([summary]) → page (standings only)
linked: load → pushSummary + getBoard → rankedKids(board.houses), houseCup(board.houses)
              → page (standings + Cup + cheers)
```

---

## Error Handling
- Solo mode touches only the local DB; a failure there surfaces the existing error path,
  not a blank page.
- Linked mode keeps today's behavior: `getBoard` failure → `unreachable` state;
  `pushSummary` failure is logged and the last-known board is shown.

---

## Testing
Use the app's existing in-memory migrated-DB Vitest harness.
- **Load (solo):** a seeded household with kids but no scoreboard creds returns
  `soloMode: true` and `ranked` containing those kids in correct order (consistency %,
  streak tiebreaker).
- **View helper:** `rankedKids([singleHouseSummary])` orders one house's kids correctly
  (extend existing `leaderboard-view` tests if not already covered).
- Existing connected-mode tests must still pass (no regression).

---

## Out of Scope / Future
- Sibling-to-sibling cheers in solo mode (deferred; flip the cheer-wall gate if wanted).
- A single-household "MVP of the week" highlight (possible later flourish).
