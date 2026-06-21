# Easy Self-Host Distribution — Design Spec

**Date:** 2026-06-21
**Status:** Approved design, pre-implementation
**Context:** Other families want to use the allowance app. The chosen model is
**each family self-hosts their own private instance** (keeping the local-first
privacy + security of the existing design), but with setup reduced to near
one-click. Today self-hosting requires cloning the repo and building the image
locally; this design removes the build step by **publishing a prebuilt image
once** so a family's whole setup is "download a compose file, set one value,
`docker compose up`."

Builds on the Docker handoff already committed (`Dockerfile`, `docker-compose.yml`,
`.env.docker.example`, `scripts/gen-secrets.js`, `SETUP-NEW-HOUSEHOLD.md` — commit
`5daa235`).

---

## Goals & Non-Goals

### Goals
- A family can stand up their own isolated instance in ~4 commands with **one**
  value to edit (`ORIGIN`), no repo clone and no local build.
- Runs on common home hardware: **multi-arch image (amd64 + arm64)** so a PC or a
  Raspberry Pi both work.
- The owner publishes the image with **no Docker on their own machine** (built in CI).
- Preserve the security/privacy model: each family's data stays in their own
  instance; every instance generates its own secrets; nothing is centralized.

### Non-Goals
- No multi-tenant / hosted "sign up and log in" service — families stay isolated.
- No change to the app's features, auth model, or the Worker.
- No automated end-to-end Docker test in this repo's CI beyond the image build
  succeeding (the controller's machine has no Docker daemon).
- Worker `/register` rate-limiting and parent remote-access are **separate** efforts.

---

## Architecture

```
  OWNER (one-time)                         EACH FAMILY (per home)
┌─────────────────────┐                  ┌───────────────────────────┐
│ public GitHub repo  │                  │ install Docker            │
│   + git push        │                  │ download compose.yml+.env │
│        │            │  ghcr.io/<owner>/│ set ORIGIN (LAN address)  │
│ GitHub Actions ─────┼─ allowance ─────▶│ docker compose up -d      │
│ buildx multi-arch   │  :latest / :vX   │   first boot: migrate +   │
│ → push GHCR (public)│                  │   auto-gen secrets        │
└─────────────────────┘                  │ onboard + /rivals connect │
                                         └───────────────────────────┘
```

The existing `Dockerfile` is reused unchanged — it's now built **in CI** instead of
on each family's machine.

---

## Components

### C1 — Publish pipeline: `.github/workflows/docker-publish.yml`
Triggers: push to `main`, and version tags `v*`.
Permissions: `contents: read`, `packages: write`.
Steps: checkout → `setup-qemu-action` → `setup-buildx-action` → `login-action`
(registry `ghcr.io`, user `${{ github.actor }}`, password `${{ secrets.GITHUB_TOKEN }}`)
→ `metadata-action` (image `ghcr.io/${{ github.repository_owner }}/allowance`,
lowercased; tags: `latest` on default branch, `type=ref,event=tag` for `vX.Y.Z`,
plus `type=sha`) → `build-push-action` (context `.`, `platforms:
linux/amd64,linux/arm64`, `push: true`, tags/labels from metadata).
- Uses the built-in `GITHUB_TOKEN` — no repository secrets to configure.
- Multi-arch arm64 layer compiles `better-sqlite3` under QEMU (slow but works in CI).

### C2 — Family run artifacts
- **`deploy/compose.yml`** — image-based (no `build:`):
  ```yaml
  services:
    app:
      image: ghcr.io/<OWNER>/allowance:latest
      restart: unless-stopped
      ports:
        - "${HOST_PORT:-3000}:3000"
      volumes:
        - allowance-data:/data      # persistent SQLite DB (DATABASE_URL=/data/app.db)
        - ./.env:/app/.env          # WRITABLE (no :ro) so first-boot secrets persist
  volumes:
    allowance-data:
  ```
- **`deploy/.env.example`** — `ORIGIN` (the only hand-set value), `DATABASE_URL=/data/app.db`,
  `PORT=3000`, and **blank** `VAPID_*` / `SESSION_SECRET` (auto-generated on first boot).
- Both live under `deploy/` so a family downloads two raw files and nothing else.

### C3 — Secrets auto-generate on first boot
- Relies on the existing `ensureSecrets()` (called at `src/hooks.server.ts:10`): on first
  run it fills blank `VAPID_*`/`SESSION_SECRET` into `/app/.env` and injects them into
  `process.env`; subsequent boots see them present and no-op.
- This requires the `.env` bind-mount to be **writable** (C2 drops the `:ro` the earlier
  pre-gen design used). The DB lives on the named volume; the `.env` (with the generated
  secrets) persists on the host file the family created.
- The only manual value is `ORIGIN`, which is irreducible — it backs the SvelteKit
  cross-site (CSRF) check that protects every form POST.

### C3a — Reconcile the existing (pre-gen) Docker files
Commit `5daa235` shipped the **pre-generate** secrets approach (`.env` mounted `:ro`,
`.env.docker.example` with a `gen-secrets` step). This design **supersedes** that with
auto-generate, so to avoid two contradictory strategies in one repo:
- Update the existing root `docker-compose.yml` to mount `.env` **writable** (drop `:ro`).
- Update `.env.docker.example` to blank `VAPID_*`/`SESSION_SECRET` (auto-gen), matching
  `deploy/.env.example`.
- Result: one secrets strategy (auto-gen) across both the build path and the image path;
  the two compose files then differ only by `build: .` vs `image: ghcr.io/<owner>/…`.

### C4 — Docs: update `SETUP-NEW-HOUSEHOLD.md`
- Lead with **"Quick start (prebuilt image)"**: install Docker → download
  `deploy/compose.yml` + `deploy/.env.example` → `cp` to `.env` → set `ORIGIN` →
  `docker compose up -d` → onboard → `/rivals` connect. Updates: `docker compose pull &&
  docker compose up -d`.
- Keep the existing **build-from-source** and **manual Node** paths below as "Advanced".
- Note the auto-gen secrets (no `gen-secrets` step needed on the prebuilt path);
  `scripts/gen-secrets.js` stays for the manual path.

---

## One-time owner setup (documented, partially manual)
1. Create a **public** GitHub repo; `git push -u origin main`.
2. The workflow runs on push and publishes `ghcr.io/<owner>/allowance:latest`. For a
   public repo the GHCR package is public; confirm/flip "package visibility" to public
   once (first publish).
3. Replace `<OWNER>` in `deploy/compose.yml` with the actual GitHub owner (a small
   `sed`/edit during setup; the implementation plan will template this).

---

## Security Considerations
- **Public image is safe:** no secrets in the image or repo (`.env`/`dev.db` gitignored;
  per-instance generation). Source visibility doesn't weaken the app — security rests on
  per-instance secrets, parent-PIN/device-claim auth, and the Friend-Code **approval**
  gate, not on secrecy of code.
- **Per-family isolation preserved:** each family runs a separate instance with its own
  DB and secrets; nothing is commingled.
- **`ORIGIN`/CSRF:** families must set `ORIGIN` to the exact address they browse to;
  documented prominently (it's the one common setup mistake).
- **Pre-publish secret scan** of git history before the repo goes public (confirm only
  `.env.example`/`.env.docker.example` are tracked, never a real `.env` or `*.db`).
- Known follow-up (separate): Worker `/register` has no rate limit; a more discoverable
  URL makes junk registrations easier (linking still gated by approval).

---

## Testing / Verification
- **Workflow validity:** the YAML is well-formed and uses pinned, current action
  versions; the first push to GitHub exercises it for real (the build succeeding in CI
  is the gate).
- **First-boot-with-blank-secrets:** confirmed against the code path (`ensureSecrets`
  wired at `hooks.server.ts:10`); must be observed working on the first real image run
  (a fresh `.env` with blank secrets boots, fills them, and serves) — can't be run on the
  controller's Docker-less machine, so it's a launch-time check.
- **Family run path = the same app already verified** (33 app tests green; the running
  server uses the identical `migrate → node -r dotenv/config build` startup).
- `compose.yml` / `.env.example` are static config; reviewed for correctness (image ref,
  writable `.env` mount, `/data` volume, port).

---

## Out of Scope / Future
- Worker `/register` rate-limiting.
- Parent remote-access (record debits away from home).
- A hosted multi-tenant version (explicitly rejected for this effort).
