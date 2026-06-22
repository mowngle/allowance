# Family Members Management — Design Spec

**Date:** 2026-06-21
**Status:** Approved design, pre-implementation
**Context:** The app has no way to manage family members after the first-run wizard. The
`/settings` page exposes only Payouts, Notifications, and Parent PIN — there is no
"add member" anywhere. Worse, the wizard's later steps are unreachable: `isSetupComplete()`
returns true the instant the *first parent* row exists, and the root `+layout.server.ts`
guard then redirects all of `/setup/*` to `/` (claimed) or `/claim` (not). So the
`/setup/kids` step the parent step redirects to is blocked before it can render — a parent
can never add kids, in setup *or* afterward. There is also no way to add a second parent at
all (the `/setup/parent` step is one-and-done). This effort adds member management — add/edit
kids and co-parents, archive (not delete) — surfaced both in Settings and in a now-working
setup wizard.

---

## Goals & Non-Goals

### Goals
- A parent can **add, edit, and archive** family members (kids and co-parents) from a
  PIN-gated **Settings → Family members** screen.
- The **first-run wizard** can add kids *and* co-parents (not just kids), and its later steps
  actually work.
- Removing a member is **non-destructive** — archive, preserving the append-only ledger and
  all history; reversible via Restore.
- The two surfaces (Settings + wizard) share one server module and one UI component so they
  cannot drift.

### Non-Goals (YAGNI)
- No role switching (a kid cannot become a parent or vice-versa).
- No avatar upload (the `avatarUrl` column exists but is out of scope here).
- No hard delete of a member or their history.
- Co-parents set their **own** PIN on their own device (the add form takes a name only) — no
  setting someone else's PIN.
- No bulk import, no per-member device management.

---

## Decisions (resolved during brainstorming)

1. **Removal = archive, not delete.** Person rows cascade-delete their chores, payout cycles,
   and entire ledger; deleting is unacceptable. Archiving flips an `active` flag and is
   reversible.
2. **Co-parent PIN = name-only add.** Each parent's PIN is per-person; the new co-parent sets
   theirs under Settings → Parent PIN after they claim their device via `/claim`.
3. **Architecture = shared module + shared component** (vs. duplicating logic per surface).

---

## Component 1 — Setup-completion marker (the core fix)

**Problem:** `isSetupComplete()` infers completion from "a parent exists," which flips true
mid-wizard and triggers the layout guard to evict the user from `/setup/*`.

**Fix:** make completion *explicit*.
- `isSetupComplete()` returns true iff `app_config['setup_completed'] === '1'`.
- The wizard's final **Done** step calls `completeSetup()` which sets that key.
- **Migration 0004 backfills** `app_config['setup_completed'] = '1'` for any DB that already
  has a parent, so existing installs (prod + dev) remain complete and are never thrown back
  into the wizard.

**Resulting flow (fresh install):** empty DB → `/setup` (family name) → `/setup/parent`
(first parent) → `/setup/members` (kids + co-parents) → **Done** → `completeSetup()` sets the
marker, the device auto-claims the first parent (existing `/setup/done` logic), redirect home.
Because the marker is set only at Done, `isSetupComplete()` stays false through the members
step, so the layout guard leaves `/setup/*` reachable until the user finishes.

No change to the layout guard's branching logic itself — only the meaning of
`isSetupComplete()` changes.

---

## Component 2 — Data model (migration `0004`)

- `persons.active` — `integer('active', { mode: 'boolean' }).notNull().default(true)`.
  Archiving sets it `false`. Mirrors the existing `chores.active` pattern.
- Data backfill (same migration): `INSERT OR IGNORE INTO app_config (key, value)
  SELECT 'setup_completed', '1' WHERE EXISTS (SELECT 1 FROM persons WHERE role = 'parent');`

The migration is generated via `drizzle-kit` for the column, with the backfill `INSERT`
appended to the generated SQL by hand (drizzle-kit only emits schema DDL).

---

## Component 3 — Server module `src/lib/server/members.ts`

One home for all member rules. Functions (all family-scoped; throw `Error` with a
user-facing message on validation failure):

- `listMembers(familyId)` → `{ parents: MemberRow[], kids: MemberRow[] }`, each row
  `{ id, name, birthdate, active }` (parents also `hasPin: boolean`). Includes archived rows
  (the UI shows them muted); callers that must exclude archived use the `active` filter
  directly (see Component 4).
- `addKid({ familyId, name, birthdate })` — trims name (required); `birthdate` must match
  `^\d{4}-\d{2}-\d{2}$`. Inserts `role: 'kid'`, `active: true`.
- `addParent({ familyId, name })` — trims name (required). Inserts `role: 'parent'`,
  `active: true`, no PIN, no birthdate.
- `editMember({ id, name, birthdate? })` — updates name; `birthdate` is validated and applied
  only for kids (same rule as add) and ignored for parents (the parent edit form has no
  birthdate field).
- `archiveMember(id)` — sets `active: false`. **Guard:** throws if the member is the last
  active parent in their family (prevents lockout).
- `restoreMember(id)` — sets `active: true`.
- `completeSetup()` — sets `app_config['setup_completed'] = '1'` (idempotent).

`isSetupComplete()` (in `setup.ts`) is updated to read the marker.

---

## Component 4 — Active-filtering pass ("archiving actually hides them")

Archiving is only correct if every read path excludes archived members. Add an
`active = true` filter to:

- `src/routes/claim/+page.server.ts` — don't list archived people as claimable.
- `src/lib/server/family.ts` — `getKidSummaries` (home parent dashboard) and any kid-listing
  helpers.
- `src/lib/server/chores.ts` — chore assignment options exclude archived kids.
- the weekly review (`getCurrentWeekReview` / `src/routes/review`) — archived kids don't get
  payout cycles or appear in review.
- `src/lib/server/leaderboard.ts` — `buildLocalSummary` ranks only active kids.
- `src/lib/server/setup.ts` — `getOrInitOnlyFamily` (`hasParent`/`hasKid`) and
  `getFirstParent` count only active persons.

Archived members keep their ledger and balance; they simply disappear from active views.
Implementation reads each call site and adds the filter; the plan enumerates them as
discrete steps so a reviewer can confirm none was missed.

---

## Component 5 — Shared UI component + two surfaces

**`src/lib/components/MemberManager.svelte`** — props: the member lists + the action endpoints
to post to (so it works under both `/settings/members` and the wizard step). Renders:
- Parents and kids in sections; archived rows shown muted with a **Restore** button.
- **Add kid** form: name + birthdate (`type=date`).
- **Add co-parent** form: name only.
- Inline **edit** (name; birthdate for kids) and **Archive** per active member.
- Validation/error and success messages via the standard SvelteKit `form` action result.

**`/settings/members`** (new route):
- `load`: require session; `role === 'parent'` else 403; `requireFreshPin(session, '/settings/members')`
  when a PIN is set (same gate as `/settings` and `/settings/payouts`). Returns `listMembers`.
- `actions`: `addKid`, `addParent`, `edit`, `archive`, `restore` — each parents-only, calling
  the module; return `fail(400, { error })` on validation failure.
- Linked from the Settings index (`/settings`) via a new "Family members" card, above Payouts.

**Wizard members step** — rename `/setup/kids` → `/setup/members`:
- `load`: as today (`getOrInitOnlyFamily`; redirect to `/setup` or `/setup/parent` if not
  ready) — no session yet, so no PIN gate. Returns `listMembers` for the only family.
- `actions`: `addKid`, `addParent`, `edit`, `archive`, `restore` (same module calls).
- A **Done** control links to `/setup/done`, whose load now also calls `completeSetup()`
  before the existing auto-claim + redirect home.
- `/setup/+page.server.ts` and `/setup/parent/+page.server.ts` redirects that pointed at
  `/setup/kids` now point at `/setup/members`.

---

## Error Handling

- Validation errors (missing name, bad birthdate) → inline `fail(400, { error })`, shown by
  the component; no throw to the user.
- Archiving the last active parent → blocked with a clear message ("You can't archive the only
  parent").
- Non-parent or unauthenticated access to `/settings/members` → 403 / redirect to `/claim`.
- Editing/archiving a member id outside the caller's family → treated as not-found (the module
  scopes every mutation by family).

---

## Testing

Existing in-memory migrated-DB Vitest harness.

- **`members.ts` unit tests:** add kid (valid + bad birthdate + empty name), add parent,
  edit name, edit kid birthdate, archive + restore round-trip, **last-active-parent archive
  guard** (throws), `completeSetup()` then `isSetupComplete()` is true.
- **Active filtering:** archived kid is excluded from the active set used by the leaderboard /
  home summaries (assert via the relevant helper after archiving).
- **Migration backfill:** a DB seeded with a parent and no marker reports `isSetupComplete()`
  true after migration (or: inserting a parent + running `completeSetup` path).
- **Prose/manual:** walk the fresh-install wizard (family → parent → add a kid + co-parent →
  Done → home) and the Settings → Family members screen on the running app.

---

## Out of Scope / Future

- Role switching, avatar upload, hard delete, co-parent PIN-on-behalf, device management.
- A "transfer primary parent" concept (which parent the first device auto-claims).
