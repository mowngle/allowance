# Onboarding: README + bootstrap.sh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stale scaffold `README.md` with a correct public front page, and add a one-command `deploy/bootstrap.sh` (Linux/macOS) that takes a family from nothing to a running app.

**Architecture:** `bootstrap.sh` is a POSIX `sh` script that checks Docker, downloads `deploy/compose.yml` + `.env.example` from the published `main`, sets `ORIGIN` from a detected/overridden LAN IP, and runs `docker compose up -d` against the prebuilt image. The README becomes a concise overview that points to `SETUP-NEW-HOUSEHOLD.md` for detail.

**Tech Stack:** POSIX `sh`, `curl`, `docker compose`, the published `ghcr.io/mowngle/allowance:latest` image, Markdown.

**Reference spec:** `docs/superpowers/specs/2026-06-21-onboarding-readme-bootstrap-design.md`

## Global Constraints

- Owner/URLs are **`mowngle`**: raw files at `https://raw.githubusercontent.com/mowngle/allowance/main/deploy/…`; image `ghcr.io/mowngle/allowance:latest`; repo `github.com/mowngle/allowance`.
- Bootstrap is **POSIX `sh`** (no bashisms), **Linux/macOS only** (no Windows/PowerShell this round).
- Port is **3000**; the install dir is **`./allowance`**.
- The script must **never overwrite an existing `.env`** (idempotent re-runs just relaunch) and must **not** install Docker (check + link out only).
- README must point to `SETUP-NEW-HOUSEHOLD.md` (no duplicated step lists) and must contain **no** stale "foundation/roadmap/Mac mini/no-DB" claims.
- `main` is branch-protected → this whole plan lands via a **PR** off `feat/onboarding-bootstrap` (already the current branch), not direct pushes to `main`.

---

## Task 1: `deploy/bootstrap.sh`

**Files:**
- Create: `deploy/bootstrap.sh`

**Interfaces:**
- Produces: a runnable script invoked as `sh deploy/bootstrap.sh` or `curl -fsSL <raw>/deploy/bootstrap.sh | sh`. Honors an optional `ALLOWANCE_IP` env var to skip detection/prompt (used for non-interactive runs + testing).
- Consumes: the already-published `deploy/compose.yml` + `deploy/.env.example` on `main`, and `ghcr.io/mowngle/allowance:latest`.

- [ ] **Step 1: Create `deploy/bootstrap.sh` with exactly this content:**

```sh
#!/bin/sh
# One-command setup for a new household (Linux/macOS).
# Usage:
#   sh bootstrap.sh
#   curl -fsSL https://raw.githubusercontent.com/mowngle/allowance/main/deploy/bootstrap.sh | sh
# Optional: set ALLOWANCE_IP to skip auto-detection (e.g. ALLOWANCE_IP=192.168.1.50 sh bootstrap.sh).
# See SETUP-NEW-HOUSEHOLD.md for manual / Windows / advanced options.
set -eu

RAW="https://raw.githubusercontent.com/mowngle/allowance/main/deploy"
DIR="allowance"
PORT="3000"

# Best-guess LAN IPv4: Linux route source, then macOS default-iface, then hostname.
detect_ip() {
  _ip="$(ip -4 route get 1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
  if [ -z "$_ip" ]; then
    _if="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
    [ -n "$_if" ] && _ip="$(ipconfig getifaddr "$_if" 2>/dev/null || true)"
  fi
  [ -z "$_ip" ] && _ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf '%s' "$_ip"
}

# 1. Preflight
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker isn't installed. Install it first: https://www.docker.com/products/docker-desktop/" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but the daemon isn't running. Start Docker and re-run." >&2
  exit 1
fi

# 2. Install dir
mkdir -p "$DIR"
cd "$DIR"

# 3 + 4 + 5. First-time config (idempotent: keep an existing .env)
if [ -f .env ]; then
  echo "Found an existing .env in $(pwd) — keeping it and re-launching."
else
  echo "Downloading compose.yml and .env ..."
  curl -fsSL "$RAW/compose.yml" -o compose.yml
  curl -fsSL "$RAW/.env.example" -o .env

  ip="${ALLOWANCE_IP:-}"
  if [ -z "$ip" ]; then
    ip="$(detect_ip)"
    if [ -r /dev/tty ]; then
      printf 'Detected this machine on the LAN as: %s\n' "${ip:-<none found>}"
      printf 'Press Enter to use http://%s:%s, or type a different IP/hostname: ' "${ip:-CHANGE-ME}" "$PORT"
      if read answer </dev/tty && [ -n "$answer" ]; then
        ip="$answer"
      fi
    else
      echo "No terminal for input; using detected IP '${ip:-CHANGE-ME}'. Edit .env if that's wrong."
    fi
  fi
  [ -z "$ip" ] && ip="CHANGE-ME"

  origin="http://$ip:$PORT"
  tmp="$(mktemp)"
  sed "s|^ORIGIN=.*|ORIGIN=$origin|" .env > "$tmp" && mv "$tmp" .env
  echo "Set ORIGIN=$origin"
fi

# 6. Launch
echo "Starting the app (first run pulls the image, creates the DB, generates secrets) ..."
docker compose up -d

# 7. Next steps
origin_now="$(grep '^ORIGIN=' .env | cut -d= -f2-)"
cat <<EOF

Done. Open  ${origin_now}  in a browser.
  1. Onboard your family: create your family, add kids with birthdates, set a parent PIN.
  2. To join another household's leaderboard, open Rivals (see SETUP-NEW-HOUSEHOLD.md).

Update later:   cd $DIR && docker compose pull && docker compose up -d
EOF
```

- [ ] **Step 2: Syntax check**

Run: `cd H:/dev/allowance && sh -n deploy/bootstrap.sh && echo "syntax OK"`
Expected: prints `syntax OK` (no parse errors). Also, if `shellcheck` is installed, run `shellcheck deploy/bootstrap.sh` and fix any error-level findings; if it's not installed, skip it (note that in your report).

- [ ] **Step 3: Real end-to-end run against the published image**

This actually downloads the published `compose.yml`, pulls the image, and starts a container. Run it in a throwaway temp dir with an explicit IP (so it's non-interactive):

```bash
cd "$(mktemp -d)" && ALLOWANCE_IP=127.0.0.1 sh "H:/dev/allowance/deploy/bootstrap.sh" 2>&1 | tail -15
```
Expected: it downloads the files, sets `ORIGIN=http://127.0.0.1:3000`, runs `docker compose up -d`, and prints the "Done. Open http://127.0.0.1:3000" next-steps block.

- [ ] **Step 4: Verify it's actually serving, then tear down**

```bash
sleep 6
curl -s -o /dev/null -w "GET / -> HTTP %{http_code} (303 expected)\n" http://localhost:3000/
# teardown: stop the container + volume, and remove the temp install dir
( cd allowance && docker compose down -v ) && cd / && echo "torn down"
```
Expected: `GET / -> HTTP 303`; then a clean teardown. (If `docker compose` reports the project name, that's fine.) Confirm no leftover container: `docker ps -a --filter name=allowance --format '{{.Names}}'` should be empty.

- [ ] **Step 5: Commit**

```bash
git -C H:/dev/allowance add deploy/bootstrap.sh
git -C H:/dev/allowance commit -m "feat(deploy): one-command bootstrap.sh for new households"
```

---

## Task 2: README rewrite + SETUP one-liner

**Files:**
- Modify (full rewrite): `README.md`
- Modify: `SETUP-NEW-HOUSEHOLD.md` (add the one-liner atop the prebuilt quick start)

**Interfaces:**
- Consumes: `deploy/bootstrap.sh` (Task 1) — the README + SETUP reference its `curl … | sh` one-liner.

- [ ] **Step 1: Replace the ENTIRE contents of `README.md` with:**

```markdown
# Allowance

A self-hosted family chore + allowance tracker. Each family runs its own private copy on a
machine at home — a PC, a mini-PC, or a Raspberry Pi — and your family's chores, money, and
data never leave it. Families can optionally opt into a friendly **cross-home leaderboard**,
the only thing ever shared between homes.

## Features

- **Chores** with flexible recurrence and per-chore expiry (vanish or roll-forward)
- **Weekly review** with **configurable payouts** — a fixed amount, or age × rate + bonus,
  set per family with optional per-kid overrides
- **Append-only ledger** with kid-visible debit descriptions; a kid's balance is the sum of
  their entries
- **Parent PIN** gating approvals and money actions; **web push** to parent phones
- **Cross-home leaderboard** (opt-in) — consistency %, streaks, badges, and canned "cheers"
  across linked households via a small Cloudflare Worker; **money stays private to each home**
- **Fire-tablet wrapper** — a Kotlin WebView app so kids' Amazon Fire tablets reach the app
  without a browser

## Quick start (self-host)

On a Linux or macOS host with Docker installed, one command:

```sh
curl -fsSL https://raw.githubusercontent.com/mowngle/allowance/main/deploy/bootstrap.sh | sh
```

It downloads the compose file, sets your home's address, and launches the app (pulling the
prebuilt image, creating the database, and generating this household's own secrets). Then open
the URL it prints and onboard your family.

Prefer to do it by hand, or running on a Raspberry Pi / Windows / from source? See
**[SETUP-NEW-HOUSEHOLD.md](SETUP-NEW-HOUSEHOLD.md)** for the Docker, build-from-source, and
manual paths — plus how to connect to another household's leaderboard.

## How it works

```
  YOUR HOME                          FRIEND'S HOME
  app + SQLite (LAN)                 app + SQLite (LAN)
         \                              /
          \___ each pushes only ______ /
               derived summary numbers
               to a shared Cloudflare
               Worker, and links via
               Friend Codes
```

Each home is fully self-sufficient and private. The Worker only ever holds derived leaderboard
numbers (consistency %, streaks, badges) — never chore details, descriptions, or money.

## Built with

SvelteKit (`adapter-node`) · SQLite + Drizzle ORM · TailwindCSS · Cloudflare Workers + KV
(the scoreboard) · Kotlin (the Fire-tablet wrapper).

## Development

```sh
npm install
npm run dev      # http://localhost:5173 — also reachable on your LAN
```

Run the tests with `npx svelte-kit sync && npm test` (the sync step generates the tsconfig base
that the suite needs on a fresh clone). The cross-home scoreboard Worker lives in
[`worker/`](worker/) and has its own README.

## License

[MIT](LICENSE)
```

- [ ] **Step 2: Add the one-liner to `SETUP-NEW-HOUSEHOLD.md`.** In the "## Quick start (prebuilt image — recommended)" section, immediately under its intro sentence ("No cloning or building — just Docker and two small files.") and BEFORE the numbered "Install Docker" list, insert:

```markdown
**Fastest — one command (Linux/macOS):**
```sh
curl -fsSL https://raw.githubusercontent.com/mowngle/allowance/main/deploy/bootstrap.sh | sh
```
This does steps 1–4 below for you (downloads the files, sets `ORIGIN` from your LAN address,
and launches). Prefer to see each step? Follow the manual version:
```

(Leave the existing numbered steps intact below it as the manual fallback.)

- [ ] **Step 3: Verify the docs are accurate**

Run:
```bash
cd H:/dev/allowance
grep -n "Mac mini\|No DB yet\|scaffold\|Project scaffolded\|\[ \]" README.md && echo "STALE TEXT REMAINS — fix" || echo "OK: no stale scaffold/roadmap text"
grep -c "mowngle/allowance" README.md SETUP-NEW-HOUSEHOLD.md
grep -n "SETUP-NEW-HOUSEHOLD.md" README.md && echo "OK: README links to the setup guide"
```
Expected: `OK: no stale scaffold/roadmap text`; both files reference `mowngle/allowance`; the README links to `SETUP-NEW-HOUSEHOLD.md`. Read the rendered README once for tone/accuracy (correct image name, correct URLs, no leftover stale claims).

- [ ] **Step 4: Commit**

```bash
git -C H:/dev/allowance add README.md SETUP-NEW-HOUSEHOLD.md
git -C H:/dev/allowance commit -m "docs: rewrite README; add one-command bootstrap to setup guide"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** README rewrite (Component 1) → Task 2 Step 1. `deploy/bootstrap.sh` flow — preflight / install dir / idempotent / fetch / detect+confirm IP via `/dev/tty` / launch / next-steps (Component 2) → Task 1 Step 1 (full script). Doc cross-refs (Component 3) → Task 2 Steps 1–2 (README → SETUP link; SETUP one-liner). Testing (syntax + real e2e run + teardown, prose review) → Task 1 Steps 2–4, Task 2 Step 3. PR process → Global Constraints + execution.
- **Placeholder scan:** none — the full script and full README are inline; the IP-detection snippet is concrete.
- **Consistency:** `mowngle` URLs, `ghcr.io/mowngle/allowance:latest`, port `3000`, `./allowance` dir, and the `ALLOWANCE_IP` override are identical across the script, the README quick start, and the SETUP one-liner. `npm test` note matches the real fresh-clone requirement (`svelte-kit sync` first).
- **Scope:** two files of substance (`bootstrap.sh`, `README.md`) + one small SETUP insert — within constraints; no Windows script, no CI shellcheck step (both out of scope per spec).
```
