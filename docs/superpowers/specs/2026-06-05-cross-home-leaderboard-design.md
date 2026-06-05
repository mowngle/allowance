# Cross-Home Leaderboard — Design Spec

**Date:** 2026-06-05
**Status:** Approved design, pre-implementation
**Context:** Multiple families each self-host their own `allowance` instance. They want
to opt into shared, gamified competition with each other — a flexible network of
rivalries — without coupling households' daily operation or exposing private
chore/money data.

---

## 1. Goals & Non-Goals

### Goals
- A fun, **fair-across-ages** leaderboard spanning a family's chosen rivals.
- **Opt-in network model:** any family can compete with as many other families as it
  wants. Links are **mutual** (both opt in) and **non-transitive** — A↔B and A↔C does
  *not* create B↔C. B and C never see each other unless they link directly.
- **Hybrid** competition: individual kid standings *and* a house-vs-house "Cup".
- Keep each home **fully self-sufficient** — no family's daily app depends on another
  being online.
- Strong **privacy boundary**: only derived summary numbers leave a house, and only to
  families it has explicitly linked with.
- Light, **safe** social layer (kid cheers) gated by parent permission.

### Non-Goals (v1)
- Real-time updates. The board is eventually-consistent (syncs nightly + on demand).
- Free-text kid messaging. v1 is canned phrases only.
- Cross-home payout/money visibility. Money never leaves a house.
- One-directional "following" — all links are mutual/consensual.
- Power-ups/tokens and multi-week "seasons" — deferred to v2.

---

## 2. Architecture

Local-first, with a shared scoreboard service that holds summaries **and** the
opt-in rivalry graph, and authorizes every read against that graph.

```
 FAMILY A          FAMILY B          FAMILY C
┌─────────┐       ┌─────────┐       ┌─────────┐
│ app + db│       │ app + db│       │ app + db│
└────┬────┘       └────┬────┘       └────┬────┘
     │ push summary/cheers; pull MY league's board
     ▼                 ▼                 ▼
        ┌──────────────────────────────────┐
        │        SHARED SCOREBOARD         │  Cloudflare Worker + KV
        │  summaries · cheer feeds ·       │
        │  league graph (who↔who) ·        │
        │  authorizes reads per link       │
        └──────────────────────────────────┘

 Links (mutual, non-transitive):  A↔B, A↔C   (B and C are NOT linked)
 A's board sees {A,B,C}.  B's board sees {A,B}.  C's board sees {A,C}.
```

- Each home **computes summaries locally** and pushes a small JSON blob up. It pulls
  **its league's** combined board down to render `/leaderboard`.
- The scoreboard stores, per house: the latest summary, an outbound cheer feed, an
  auth token (hashed), and the set of houses it's linked to. On a read it returns
  data **only** for the requester plus the houses it is linked with.
- **Resilience:** if a home can't reach the scoreboard, its daily app is unaffected.
  The board shows last-known numbers with a "last updated" note.

### Scoreboard service (decided: Cloudflare Workers + KV)
- Free tier comfortably covers a handful of families.
- A small Worker (more than the original ~50 lines now that it holds the graph, but
  still modest); nothing to keep alive; neutral ground.
- KV keys:
  - `house:<houseId>` → `{ name, tokenHash, friendCode, createdAt }`
  - `friendcode:<code>` → `houseId` (reverse lookup for a family's persistent code)
  - `summary:<houseId>` → latest summary blob
  - `links:<houseId>` → array of linked `houseId`s (mutual: edge written on both sides)
  - `requests:<houseId>` → array of pending incoming link requests
    `{ fromHouseId, fromName, ts }`
  - `cheers:<houseId>` → capped list (~last 50) of that house's outbound cheers

---

## 3. Scoring

Two stats per kid, both derived from data already in the schema
(`chore_instances`, `chores`, `persons.family_id`). No core schema change required.

### Consistency % (fair base)
```
consistency % = confirmed-this-week ÷ total-this-week × 100
```
- Window = existing `weekStarting(today)` → `weekEnding(today)` (Mon–Sun).
- Mirrors `getCurrentWeekReview()`: a chore counts as done the moment the **kid
  marks it** (`done` status), same as the existing `confirmedCount + doneCount`
  treatment in `payouts.ts`. This prevents a slow-to-approve parent from tanking
  their own kid's score. `pending`/`disputed` (past due) = miss.
- Age-neutral by construction: fewer chores is not a disadvantage.

### Streak (tiebreaker & drama)
- Consecutive days with **no missed chores** (nothing `pending`/`disputed` past its
  due date), walking backwards day-by-day until a miss is hit.
- Daily-resolution version of the existing `getWeekProgress` "on track" check.

### Ranking
- Primary: consistency % (descending).
- Tiebreaker: **longer streak wins**.
- Both stats shown explicitly (`92% · 🔥6`), never mashed into one opaque number.
- Resets weekly / on-miss, so a kid who falls behind is never permanently buried.

### Money
- **Never** crosses homes and never appears on the board.

---

## 4. Summary Payload (the privacy boundary)

The **only** data that leaves a house. Computed locally, pushed up.

```json
{
  "houseId": "h_8f3a…",
  "house": "Smith",
  "weekStarting": "2026-06-01",
  "kids": [
    {
      "name": "Mia",
      "avatar": "🦊",
      "pct": 92,
      "streak": 6,
      "choresDone": 11,
      "badges": ["dawn-patrol", "perfect-week"]
    }
  ],
  "updatedAt": 1717286400000
}
```

No chore names, descriptions, dollar amounts, ledger entries, or birthdates (only the
derived %). And it's only ever served to linked houses.

---

## 5. Pairing & League Graph

Each family has a **persistent Friend Code** (gamer-tag style, e.g. `SMITH-7K2Q`),
generated once when it first connects to the scoreboard and shown in parent settings.
One code is shared with everyone the family wants in its league. Links are **mutual**
and **non-transitive**.

How two families become rivals:

1. Family A shares its Friend Code with B out-of-band (text/email/in person).
2. B enters A's code → app calls `POST /link-request` with B's token + the code → the
   Worker resolves the code to A's `houseId` and appends a pending request to
   `requests:A` (`{ fromHouseId: B, fromName, ts }`). **No link yet.**
3. A parent in **A's** home sees the pending request in Manage Rivals and **approves**
   it (PIN-gated). The Worker then writes the **mutual** edge — B into `links:A`, A
   into `links:B` — and clears the request. (Decline just drops the request.)
4. Now A and B appear on each other's boards. A doing the same with C links A↔C but
   leaves B and C unlinked.

**Why approval:** a Friend Code is reusable and long-lived, so a leaked code must not
auto-join anyone — entering a code only *requests*; the owner stays in control.

A family can **leave a rivalry** at any time (removes the edge on both sides; each
stops seeing the other). Inviting, approving/declining requests, and leaving all live
in parent settings (PIN-gated).

---

## 6. House Cup + Badges (hybrid layer)

### House Cup — per-viewer league Cup
- House score = **average** of that house's kids' consistency % (average, not sum,
  so a larger house doesn't auto-win).
- Each family's board crowns the top-scoring house **among the families it sees**.
  Because leagues differ, A's Cup (among {A,B,C}) and B's Cup (among {A,B,D}) can
  differ — each board still has a clear champion for its own league.
- Computed at render time from the league's summaries; no extra storage.

### Badges (computed locally, shipped in the summary)
| Badge | Rule |
|-------|------|
| 🔥 Iron Streak | 14+ day streak |
| 🌅 Dawn Patrol | chores marked done before 8am, 5 days running |
| 📈 Comeback Kid | biggest % jump vs. last week |
| 💯 Perfect Week | 100% consistency |
| 🏆 Cup Holder | your house holds the Cup on your own board |

Badges let young kids shine independent of raw rank.

---

## 7. Cheer Wall (v1: canned only)

- **Curated phrase set** ships with the app (positive/playful, no insults), e.g.:
  `Nice streak! 🔥`, `Catch me if you can 😎`, `GG 👏`, `Comeback szn 📈`,
  `Cup is coming home 🏆`. Families can edit the list. Kids only **pick**, never type.
- **Per-kid permission, default OFF.** A parent enables "can post cheers" per child,
  PIN-gated. An off kid can read the wall but not post.
- **Cheer entry:** `{ fromName, fromHouse, avatar, phraseId, ts }`. Appended locally,
  pushed to `cheers:<ownHouseId>` on sync (capped ~50, oldest age out).
- **Scope = your league.** A viewer's wall merges cheers from itself + each linked
  house (the Worker returns only those, same authorization as summaries). So a cheer A
  posts is seen by everyone linked to A, but not by families A isn't linked to.
- **Display:** a feed on `/leaderboard` under the standings
  (e.g. "🦊 Mia: Catch me if you can 😎").
- **Latency:** rides the existing sync, so cheers are near-real-time, not instant; the
  on-demand "refresh" tap makes an active back-and-forth feel live enough.

---

## 8. Sync & Trust

- **When:** nightly cron (alongside the planned nightly backup job), plus an on-demand
  "refresh" tap on `/leaderboard`.
- **Direction:** each home pushes (its summary + new cheers) and pulls (its league's
  combined board + cheer feed).
- **Auth:** each house has a secret token (hash stored as `house:<id>.tokenHash`),
  sent on every request. The Worker authenticates the caller, then **authorizes**:
  writes touch only the caller's own keys; reads return only the caller + its linked
  houses. A family cannot read a house it isn't linked with.
- **Pairing trust:** a Friend Code only lets a family *request* a link; the owning
  family must approve it. A leaked code can't auto-join a league — at worst it queues
  a request the owner declines. No family is added unilaterally.
- **Failure mode:** unreachable scoreboard never breaks the local daily app; the board
  shows last-known data with a staleness note.

---

## 9. Leaderboard Screen

New `/leaderboard` route in the existing SvelteKit app:
1. **House Cup banner** — the champion of *your* league (🏆 which house holds it).
2. **Ranked kid list** — everyone in your league merged into one list: avatar, %,
   🔥streak, badge icons; subtle "you" highlight for local kids.
3. **Cheer feed** below the standings; a "post a cheer" control for permitted local
   kids; a "refresh" action to pull latest.
4. **Manage rivals** (parent settings, PIN-gated): view/share your Friend Code, enter
   another family's code to request a link, approve/decline incoming requests, leave a
   rivalry.

---

## 10. Component Boundaries (implementation sketch)

- `src/lib/server/leaderboard.ts` — compute consistency %, streaks, badges, and the
  per-house average for the local family; build the summary payload. Reads over
  existing tables.
- `src/lib/server/scoreboard-client.ts` — push summary/cheers, pull the league board,
  run pairing calls (request / approve / decline / leave) and fetch pending requests.
  Handles auth header + offline/staleness.
- `src/routes/leaderboard/+page.server.ts` / `+page.svelte` — render Cup + standings +
  cheers; handle "post cheer", "refresh".
- Parent settings UI — per-kid "can post cheers" toggle; manage-rivals (invite, link,
  leave). PIN-gated.
- Cheer phrase set — a small shared constant (e.g. `src/lib/cheers.ts`).
- **Scoreboard Worker** (separate deployable): endpoints roughly
  `POST /summary`, `POST /cheer`, `GET /board`, `GET /requests`, `POST /link-request`,
  `POST /link-approve`, `POST /link-decline`, `POST /leave`. Token auth on all;
  graph-based authorization on reads. KV-backed. A house's Friend Code is issued at
  first connect and resolvable via `friendcode:<code>`.

No changes to `schema.ts` are required for scoring (all derived). Local additions to
confirm during planning: where to store the per-kid "can post cheers" flag (on
`persons` vs. app config) and this instance's own `houseId` + scoreboard token.

---

## 11. Future Work (out of scope for this spec)

- **Payout configuration** (separate follow-up spec): the core app currently hardcodes
  `age × $1` in `payouts.ts`. To support other families, make payout configurable —
  **Fixed OR age + modifiers** (`amount = fixed` OR `age × ratePerYear + bonus`), as a
  family default with optional per-kid override. Independent of the leaderboard
  (which is money-blind). Spec separately.
- Free-text cheers with parent pre-approval (v2 tier).
- Power-ups / streak-spend tokens.
- Multi-week "seasons" with champions.
- Parent "hide" / report control on the cheer wall.
- Possible future: cross-league badges or "open" leagues several families share.
