# Queued Payout Review — Design Spec

## Problem

The weekly review is the only path from "kid did chores" to "money in the ledger,"
and it silently expires.

`getCurrentWeekReview()` (`src/lib/server/payouts.ts`) looks at exactly one week —
`weekStarting(todayIso())`. Payout cycles are created lazily, on `/review` page load.
So a week a parent doesn't review is lost in one of two ways:

- **Nobody opened `/review` that week** — no `payout_cycles` row was ever created.
  The week does not exist in the database.
- **Someone opened it but took no action** — the cycle sits at `status: 'open'`
  forever, and no read path ever asks for it again.

Either way the allowance for that week is unrecoverable through the UI. There is no
backlog, no reminder, and no way to pay a kid for a week you missed.

The underlying data is intact: `chore_instances` rows carry `due_date`, so any past
week's chore completion can be reconstructed exactly. Only the review path forgets.

## Goals

- No unreviewed week is ever unreachable. A parent returning after an absence can
  pay out every week they missed.
- The review screen stays legible after a long absence — a backlog is a short list,
  not a wall.
- A past week's suggested amount reflects the kid's age *during that week*.
- A parent is reminded once a week when a review is outstanding.

## Non-goals

- Kid-facing visibility of queued weeks. Balance stays ledger-derived; an unreviewed
  week is invisible to the kid until approved. Surfacing "3 weeks pending" on the
  kid's page turns the queue into a nag directed at the parent through their
  children. Explicitly rejected.
- Automatic payout. A missed week still requires a parent decision; queuing changes
  *when* that decision can be made, not *whether* it is made.
- Changing the responsibility week boundary. Weeks stay Mon–Sun via `weekStarting()`.

## Approach

Backfill lazily, on read.

`getCurrentWeekReview` is replaced by `getReviewQueue`, which walks back from today
to a per-kid floor date, get-or-creates a cycle for every week in that span, and
returns the ones still awaiting a decision.

### Why not a nightly materializer?

A `scheduleWeeklyRollover()` alongside the existing nightly jobs would close out each
week proactively, leaving `/review` as a pure read. But a cycle would only exist if
the server happened to be running that night, and this is a self-hosted box that gets
powered off. The read path would still need gap-filling logic to be correct — at
which point the nightly job materializes nothing the read path wasn't already going
to handle.

Lazy backfill is self-healing: correct after a month of downtime, correct on a fresh
restore from backup, and it has no second code path to keep in sync.

A scheduled job is still used for the *reminder*, which genuinely needs a clock.

## Data model

**No schema change.** `payout_cycles` already carries everything a queued week needs:

| column | role in the queue |
|---|---|
| `(kid_id, week_starting)` unique | makes get-or-create idempotent under concurrent backfill |
| `status` | `'open'` in the past *is* a queued week |
| `suggested_amount_cents` | frozen at creation for past weeks |
| `reviewed_at` / `reviewed_by` / `note` | unchanged |

No new status value. A "missed" week is not a distinct state — it is an `open` cycle
whose week has ended, which is derivable from `week_starting` and today's date.

The nudge stores no state either. The scheduler fires once per day; on payout day it
checks for outstanding cycles and pushes. Firing once per week is a property of the
clock, not a flag we persist.

## Components

### `getReviewQueue(familyId)` — `src/lib/server/payouts.ts`

Replaces `getCurrentWeekReview`. Its only consumer is `src/routes/review/+page.server.ts`
(verified: nothing else in `src/` reads `payout_cycles`).

For each active kid in the family:

1. **Determine the floor.** `weekStarting(toIsoDate(max(kid.createdAt, family.createdAt)))`.
   A kid added last month is not owed for weeks before they existed. Both columns are
   epoch-ms integers and must be converted to ISO dates before `weekStarting()`.
2. **Enumerate weeks** from the floor to `weekStarting(todayIso())`, inclusive, stepping
   7 days.
3. **Get-or-create a cycle** for each week. On create, set
   `suggested_amount_cents = computeSuggestedCents(resolvePayoutConfig(family, kid.payoutOverride), ageOn(kid.birthdate, weekEnding(wk)))`.
4. **Refresh only the current week's suggestion.** The existing mid-week birthday
   refresh (`payouts.ts:98`) is retained but gated to the current week. A past week's
   amount is history and must not move once written.
5. **Build the summary** from `chore_instances` joined to `chores`, filtered to
   `due_date BETWEEN weekStarting(wk) AND weekEnding(wk)`. Identical to the current
   query, parameterized by week instead of hardcoded to today.
6. **Drop finalized cycles.** `paid` and `skipped` cycles never enter the queue.
   Both `open` and `reviewed` do. Nothing in the current codebase ever writes
   `reviewed` — it is an unreachable status — but including it keeps the queue correct
   if a "decide now, pay later" step is added, and costs one extra value in a filter.

**Return shape:**

```ts
type ReviewQueue = {
  current: WeeklyReviewItem[];   // the in-progress week, one item per kid
  recent: WeeklyReviewItem[];    // items from the 2 most recent past unreviewed weeks
  older: WeeklyReviewItem[];     // everything before that, newest week first
};
```

All three are arrays: a family has several kids, and each kid has an item per week.
`current` is empty only when the family has no active kids.

**Bucketing is by week, not by kid.** Take the distinct `weekStarting` values present
among past unreviewed items, sorted newest first; the first two weeks' items go to
`recent`, the rest to `older`. This keeps siblings side by side within a week, which
is how the existing screen already reads, and makes "5 earlier weeks" a count of
weeks rather than of cards.

Bucketing happens here, not in the route. The route renders three sections and does
no date arithmetic.

`WeeklyReviewItem` is unchanged — it already carries `weekStarting` and `weekEnding`.

**Performance:** week enumeration is bounded by the floor, so the worst realistic case
is a family running for a few years — low hundreds of weeks per kid, each a single
indexed lookup. If this ever matters, the fix is one query for all existing cycles in
the span rather than one per week; not worth doing pre-emptively.

### `approvePayoutBatch` / `skipPayoutBatch` — `src/lib/server/payouts.ts`

```ts
approvePayoutBatch(parentPersonId: string, cycleIds: string[], note?: string): Promise<number>
skipPayoutBatch(parentPersonId: string, cycleIds: string[], note?: string): Promise<number>
```

Added beside the existing single-cycle `approvePayout` / `skipPayout`, which stay as
they are.

Each wraps a `db.transaction`. Inside the transaction, for each id:

- Re-read the cycle.
- Skip it if missing or already `paid`/`skipped`.
- Otherwise write the same updates the single-cycle function writes, using **that
  cycle's own** `suggested_amount_cents` — so a birthday inside the backlog produces
  $8 for May weeks and $9 for June weeks from a single tap.
- Insert one `ledger_entries` row per approved cycle, description defaulting to
  `Weekly allowance (week of <week_starting>)`.

Returns the number of cycles actually acted on, so the UI reports what happened rather
than what was requested.

**Why a transaction:** both parents' phones can hit "Approve all" simultaneously, and
a double-tap on a slow LAN is ordinary. Re-reading status inside the transaction makes
the second call a no-op instead of a double payout. The batch is all-or-nothing: a
failure partway through rolls back rather than leaving half a backlog paid.

### Review route — `src/routes/review/+page.server.ts`

`load` calls `getReviewQueue` and returns the three buckets. Two new form actions,
`approveAll` and `skipAll`, accept a repeated `cycleId` field
(`data.getAll('cycleId')`) and call the batch functions. Existing `approve` and `skip`
actions are untouched. Parent-role and `requireFreshPin` guards are unchanged and
apply to the new actions identically.

### Review UI — `src/routes/review/+page.svelte`

- `current` and `recent` render as the existing per-kid cards, each labeled with its
  week ("Week of Jun 9"). Approve / adjust / skip controls are unchanged except for
  their visibility condition: the template currently gates them on `status === 'open'`
  and must gate on `status !== 'paid' && status !== 'skipped'`, so a `reviewed` cycle
  is still actionable.
- `older` renders as a single summary row — "5 earlier weeks · $41.00" — with
  **Approve all** and **Skip all** buttons posting every id in the bucket, plus a
  disclosure that expands into individual cards using the same per-cycle controls.

The 2-week detail threshold is a constant in `payouts.ts`, not scattered through the
template.

### Sunday nudge — `src/lib/server/payouts.ts` + `src/hooks.server.ts`

`scheduleWeeklyReviewNudge()` follows the arm/re-arm pattern already used by
`scheduleNightlyBackup` and `scheduleNightlySummaryPush`, including the
`globalThis` guard against double-arming across hot reloads.

Daily timer at 18:00 local. On fire, for each family:

- If `dayOfWeek(todayIso()) !== family.payoutDay`, do nothing.
- If the family's review queue is empty, do nothing.
- Otherwise `sendToFamilyParents(familyId, { title, body, url: '/review', tag: 'weekly-review' })`
  with a body summarizing kid count and total suggested amount.

Registered in `hooks.server.ts` beside the two existing schedulers.

**On `payoutDay`:** the column is written at setup (`src/routes/setup/+page.server.ts`)
and read by nothing — a family that chose Friday has had an inert setting. The nudge
reads it. Its default is `0` (Sunday), which is the desired behavior here; wiring it
costs nothing and gives the setup question an effect. The week boundary itself stays
Mon–Sun and is unaffected.

**Failure mode:** server off at 18:00 on payout day means no nudge that week. Accepted
— the queue, not the reminder, is the thing that prevents loss.

## Error handling

- **Missing birthdate** — `ageOn` is already guarded by `kid.birthdate ? ... : 0` in
  the current code; backfill keeps that behavior, yielding a $0 suggestion the parent
  can adjust.
- **Batch with an already-finalized cycle** — skipped silently, excluded from the
  returned count. Not an error; it is the expected outcome of a double-tap.
- **Batch with an unknown cycle id** — skipped, same as above. The ids come from the
  page's own render, so a mismatch means the page is stale, and re-rendering is the
  correct recovery.
- **Cycle belonging to another family** — batch functions must verify each cycle's kid
  belongs to `locals.session.familyId` before acting. The single-cycle functions
  currently do not check this; the batch path takes ids straight from form data, so it
  must.
- **Push failure** — already caught and logged inside `sendToFamilyParents` callers;
  the nudge wraps its own body in try/catch so a failed push never breaks the re-arm.

## Testing

Vitest with the existing `seedFamily` / `seedKid` helpers (`src/lib/server/test/seed.ts`).
Tests seed cycles and chore instances at explicit past dates rather than relying on
wall-clock time.

**Backfill (`payouts.test.ts`):**
- A kid with no cycles and a 6-week-old `createdAt` produces 6 queued weeks.
- Weeks before `max(kid.createdAt, family.createdAt)` are not created.
- A kid whose birthday falls mid-backlog gets per-week amounts matching age at each
  week's end.
- A past week's `suggested_amount_cents` does not change on a second `getReviewQueue`
  call after a birthday.
- Already `paid` / `skipped` weeks do not reappear in the queue.
- Chore counts on a backfilled week reflect that week's instances, not today's.
- Calling `getReviewQueue` twice creates no duplicate cycles.

**Bucketing:**
- 6 unreviewed past weeks → `recent` has 2, `older` has 4, newest first.
- 1 unreviewed past week → `older` is empty.

**Batch actions:**
- `approvePayoutBatch` over 5 cycles creates 5 ledger entries with per-week amounts.
- A batch including an already-paid cycle pays the rest and returns the lower count.
- A batch containing a cycle from another family is rejected.
- `skipPayoutBatch` creates no ledger entries.

**Nudge:**
- Fires only when `dayOfWeek === payoutDay`.
- Does not fire when the queue is empty.

## Migration

None. No schema change, and existing `open` cycles from past weeks are picked up by
the new read path automatically — they become the first entries in the queue.
