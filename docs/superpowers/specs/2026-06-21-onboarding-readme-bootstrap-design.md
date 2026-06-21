# Onboarding: README rewrite + bootstrap script — Design Spec

**Date:** 2026-06-21
**Status:** Approved design, pre-implementation
**Context:** The repo is now public (`github.com/mowngle/allowance`) with a published
multi-arch image, but the root `README.md` is the original *scaffold* README — it claims
"No DB yet, no auth, no real screens," targets a "Mac mini," and lists an all-unchecked
roadmap of features that now ship. As the front page of a public repo it's actively
misleading. Separately, a new family's setup still has several fiddly steps (download two
files, find the LAN IP, edit `.env`, `docker compose up`). This effort fixes the README
and adds a one-command `sh` bootstrap to collapse those steps.

---

## Goals & Non-Goals

### Goals
- A correct, useful public `README.md` that **points to `SETUP-NEW-HOUSEHOLD.md`** for the
  detailed steps rather than duplicating them.
- A `deploy/bootstrap.sh` (Linux/macOS) that takes a family from nothing to a running app
  in one command: fetch config → set `ORIGIN` → `docker compose up`.

### Non-Goals
- No Windows PowerShell bootstrap (sh only this round; Windows hosts use the manual guide).
- No change to the app, the image, the Worker, or `SETUP-NEW-HOUSEHOLD.md`'s substance
  (only add a short "one-command" pointer to it / from it).
- The script does **not** install Docker (too invasive) — it checks for it and links out.

---

## Component 1 — `README.md` (full rewrite)

Replace the entire file. Structure (kept tight; detail lives in the linked guide):
1. **Title + one-paragraph what-it-is** — self-hosted family chore + allowance tracker;
   LAN-first; private per home; optional opt-in cross-home leaderboard.
2. **Features** — chores with recurrence + expiry; weekly review with configurable payouts
   (fixed or age×rate+bonus, per-kid overrides); append-only ledger with kid-visible
   debits; parent PIN; parent web push; cross-home leaderboard (consistency %, streaks,
   badges, cheers) via the Cloudflare Worker; Fire-tablet WebView wrapper.
3. **Quick start** — the one-line bootstrap (`curl -fsSL …/deploy/bootstrap.sh | sh`) for
   the common case, then "for Docker/manual/advanced, see **SETUP-NEW-HOUSEHOLD.md**."
4. **How it works** — a small ASCII diagram: each home runs its own app (local/LAN);
   the only shared piece is the Worker scoreboard; families link via Friend Codes.
5. **Built with** — SvelteKit + `adapter-node`, SQLite + Drizzle, Tailwind, Cloudflare
   Workers + KV (scoreboard), Kotlin (Fire-tablet wrapper).
6. **Development** — clone, `npm install`, `npm run dev`; note `npm test` (run
   `npx svelte-kit sync` first on a fresh clone); link to `worker/README.md`.
7. **License** — MIT.

No stale "roadmap/checkpoint/wishlist" sections.

---

## Component 2 — `deploy/bootstrap.sh`

A POSIX `sh` script (runnable as `sh bootstrap.sh` or `curl -fsSL <raw>/deploy/bootstrap.sh | sh`).

**Flow:**
1. **Preflight:** `command -v docker` and `docker info` succeed, else print a clear message
   + the Docker install URL and exit non-zero.
2. **Install dir:** create/use `./allowance` (so the family ends with a tidy folder);
   `cd` into it.
3. **Idempotency:** if `.env` already exists in the install dir, skip fetching/prompting
   (preserve the family's existing config) and jump to launch.
4. **Fetch:** download `deploy/compose.yml` → `compose.yml` and `deploy/.env.example` →
   `.env` from `raw.githubusercontent.com/mowngle/allowance/main` (via `curl -fsSL`).
5. **Set `ORIGIN`:** detect a best-guess LAN IPv4 (route-based, with a `hostname`
   fallback); **show it and read a confirm/override from `/dev/tty`** (so prompting works
   even under `curl | sh`). If there's no controlling terminal, use the detected IP and
   print a "verify this address" note. Rewrite the `ORIGIN=` line in `.env` to
   `http://<ip>:3000`.
6. **Launch:** `docker compose up -d` (pulls the public image, first boot migrates +
   auto-generates secrets).
7. **Next steps:** print the URL to open (`http://<ip>:3000`), "onboard your family
   (create family, add kids, set a parent PIN)," and the `/rivals` Friend-Code note.

**IP detection (portable):** Linux `ip -4 route get 1 | awk '{print $7; exit}'`; macOS
`ipconfig getifaddr "$(route -n get default | awk '/interface:/{print $2}')"`; fallback
`hostname` first address. The exact snippet is fixed in the implementation plan.

**Safety/UX:** uses `set -e`; never overwrites an existing `.env`; the detected IP is
confirmable so a wrong guess (the classic CSRF gotcha) is caught before launch.

---

## Component 3 — Doc cross-references
- `README.md` quick start links to `SETUP-NEW-HOUSEHOLD.md` for full detail.
- `SETUP-NEW-HOUSEHOLD.md`: add a short "Fastest: one command" note at the top of the
  prebuilt quick-start showing the `bootstrap.sh` one-liner, above the manual file
  downloads (which remain for those who prefer to do it by hand).

---

## Testing
- **`deploy/bootstrap.sh`:** POSIX syntax check (`sh -n deploy/bootstrap.sh`); `shellcheck`
  if available (and add a shellcheck step to CI is out of scope here). **A real local
  end-to-end run** (Docker is available now): run it in a temp dir against the published
  image, confirm a container comes up and `curl localhost:3000` returns a real response,
  then tear down (container + the test dir).
- **README / SETUP:** prose — manual read-through for accuracy (correct image name,
  correct URLs, no stale claims).

---

## Process
`main` is branch-protected (PR required, `test` check must pass). This lands as a **PR**:
branch → push → open PR → CI green → merge. (First use of the new flow.)

---

## Out of Scope / Future
- Windows PowerShell bootstrap.
- A `shellcheck` CI step.
- Auto-installing Docker.
