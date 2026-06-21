# Easy Self-Host Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any family run the app with no repo clone and no local build — a GitHub Actions workflow publishes a prebuilt multi-arch image to GHCR, and families run a tiny image-based compose file with one value (`ORIGIN`) to set.

**Architecture:** Reuse the existing `Dockerfile`, built in GitHub CI (not on anyone's machine) and pushed to `ghcr.io/mowngle/allowance`. Families download `deploy/compose.yml` + `deploy/.env.example`, set `ORIGIN`, and `docker compose up -d`; secrets auto-generate on first boot via the existing `ensureSecrets()`. Existing pre-generate Docker files are reconciled to the auto-gen approach for one consistent strategy.

**Tech Stack:** GitHub Actions (`docker/*-action`), GitHub Container Registry (GHCR), Docker Buildx + QEMU (multi-arch), the existing SvelteKit/`adapter-node`/`better-sqlite3` app + `Dockerfile`.

**Reference spec:** `docs/superpowers/specs/2026-06-21-easy-self-host-distribution-design.md`

## Global Constraints

- Image owner/name: **`ghcr.io/mowngle/allowance`** (the GitHub account is `mowngle`).
- Multi-arch: **`linux/amd64,linux/arm64`** (must run on a PC *and* a Raspberry Pi).
- Tags: **`latest`** (default branch) + **`v*`** version tags + git **sha**.
- Secrets **auto-generate on first boot** — the family's `.env` keeps `VAPID_*`/`SESSION_SECRET` **blank**; the `.env` bind-mount is **writable** (no `:ro`) so generated secrets persist. `ORIGIN` is the only hand-set value.
- **No changes to app code, features, auth, or the Worker.** The `Dockerfile` is reused unchanged.
- Public image is safe (no secrets in repo/image); a **pre-publish secret scan** must pass.
- This machine has **no Docker daemon and no GitHub remote** — YAML/content checks are the local gate; the real image build runs in CI on the first push (a launch-time check).

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `.github/workflows/docker-publish.yml` | Build multi-arch image in CI, push to GHCR on push/tag | Create |
| `deploy/compose.yml` | Family-facing run file (image-based, persistent volume) | Create |
| `deploy/.env.example` | Family config template (ORIGIN + blank auto-gen secrets) | Create |
| `docker-compose.yml` | Dev/build compose — reconcile to writable `.env` | Modify |
| `.env.docker.example` | Build-path template — reconcile comment to auto-gen | Modify |
| `SETUP-NEW-HOUSEHOLD.md` | Lead with prebuilt path; add maintainer publish runbook | Modify |

---

## Task 1: GitHub Actions publish workflow

**Files:**
- Create: `.github/workflows/docker-publish.yml`

**Interfaces:**
- Consumes: the repo root `Dockerfile` (build context `.`) and `.dockerignore` (already committed).
- Produces: published images `ghcr.io/mowngle/allowance:latest`, `:v*`, `:sha-…` — consumed by Task 2's `deploy/compose.yml`.

- [ ] **Step 1: Create `.github/workflows/docker-publish.yml`**

```yaml
name: Publish Docker image

on:
  push:
    branches: [main]
    tags: ['v*']

permissions:
  contents: read
  packages: write

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract image metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository_owner }}/allowance
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=ref,event=tag
            type=sha

      - name: Build and push (multi-arch)
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

- [ ] **Step 2: Validate the YAML parses**

Run: `cd H:/dev/allowance && npx -y js-yaml .github/workflows/docker-publish.yml > /dev/null && echo "YAML OK"`
Expected: prints `YAML OK` (js-yaml exits non-zero on a syntax error). If `npx` cannot fetch js-yaml offline, instead run `node -e "require('fs').readFileSync('.github/workflows/docker-publish.yml','utf8')"` and visually confirm structure against Step 1.

- [ ] **Step 3: Sanity-check the key fields**

Run: `cd H:/dev/allowance && grep -nE "platforms:|images:|push: true|registry: ghcr.io|GITHUB_TOKEN" .github/workflows/docker-publish.yml`
Expected: shows `platforms: linux/amd64,linux/arm64`, `images: ghcr.io/${{ github.repository_owner }}/allowance`, `push: true`, `registry: ghcr.io`, and the `GITHUB_TOKEN` password line. Confirms multi-arch, correct registry, and built-in token auth (no repo secrets needed).

- [ ] **Step 4: Commit**

```bash
git -C H:/dev/allowance add .github/workflows/docker-publish.yml
git -C H:/dev/allowance commit -m "ci: publish multi-arch Docker image to GHCR on push and tags"
```

Note (no local CI): the workflow can only run for real once the repo is pushed to GitHub. The build succeeding in Actions is the launch-time gate; nothing here can run it locally.

---

## Task 2: Family deploy artifacts + reconcile existing Docker files to auto-gen

**Files:**
- Create: `deploy/compose.yml`
- Create: `deploy/.env.example`
- Modify: `docker-compose.yml` (make the `.env` mount writable)
- Modify: `.env.docker.example` (header comment → auto-gen)

**Interfaces:**
- Consumes: the published image `ghcr.io/mowngle/allowance:latest` (Task 1); the app's `ensureSecrets()` first-boot behavior (`src/hooks.server.ts:10`) and `DATABASE_URL=/data/app.db` convention.
- Produces: `deploy/compose.yml` + `deploy/.env.example` — the two files a family downloads (referenced by Task 3's docs).

- [ ] **Step 1: Create `deploy/compose.yml`**

```yaml
# Run the allowance app from the prebuilt image. See SETUP-NEW-HOUSEHOLD.md.
#   1. cp .env.example .env   (then set ORIGIN to this machine's LAN address)
#   2. docker compose up -d
# Update later:  docker compose pull && docker compose up -d

services:
  app:
    image: ghcr.io/mowngle/allowance:latest
    restart: unless-stopped
    ports:
      # host:container — set HOST_PORT in .env to change the external port.
      - "${HOST_PORT:-3000}:3000"
    volumes:
      # Persists the SQLite database (DATABASE_URL=/data/app.db) across restarts/upgrades.
      - allowance-data:/data
      # Writable (NOT :ro) so first-boot auto-generated secrets persist back to your .env.
      - ./.env:/app/.env

volumes:
  allowance-data:
```

- [ ] **Step 2: Create `deploy/.env.example`**

```
# Copy to .env (next to compose.yml), set ORIGIN, then run: docker compose up -d
# The four secret values auto-generate on first boot — leave them blank.

# The address other devices in your home use to reach this app — THIS machine's LAN
# IP and port. It MUST match the address you actually open in a browser, or logins are
# rejected (a cross-site safety check). Reserve a static IP for this machine in your router.
ORIGIN=http://192.168.1.50:3000

# Where the database lives inside the container (on the persistent volume). Leave as-is.
DATABASE_URL=/data/app.db

# Internal port. Leave as 3000. To use a different EXTERNAL port, uncomment HOST_PORT.
PORT=3000
# HOST_PORT=3000

# --- auto-generated on first boot; leave blank ---
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@localhost
SESSION_SECRET=
```

- [ ] **Step 3: Make the dev compose `.env` mount writable** — in `docker-compose.yml`, change the read-only mount so first-boot secrets can persist. Replace this line:

```yaml
      - ./.env:/app/.env:ro
```

with:

```yaml
      # Writable so first-boot auto-generated secrets persist back to .env.
      - ./.env:/app/.env
```

- [ ] **Step 4: Reconcile `.env.docker.example` to auto-gen** — replace the top comment block (the lines from `# Copy to .env` through the `# (or, if you have Node installed locally: npm run gen-secrets)` line) with:

```
# Copy to .env, set ORIGIN, then `docker compose up -d`.
# The four secret values auto-generate on first boot — leave them blank.
```

Leave the rest of the file as-is (`ORIGIN`, `DATABASE_URL`, `PORT`, and the already-blank `VAPID_*`/`SESSION_SECRET` lines stay).

- [ ] **Step 5: Validate both compose files parse and the reconcile is correct**

Run:
```bash
cd H:/dev/allowance
npx -y js-yaml deploy/compose.yml > /dev/null && echo "deploy/compose.yml OK"
npx -y js-yaml docker-compose.yml > /dev/null && echo "docker-compose.yml OK"
grep -n ":ro" docker-compose.yml && echo "FAIL: :ro still present" || echo "OK: no :ro in dev compose"
grep -n "image: ghcr.io/mowngle/allowance:latest" deploy/compose.yml && echo "OK: image ref correct"
```
Expected: both `… OK` lines; `OK: no :ro in dev compose`; `OK: image ref correct`. (If `npx` can't fetch js-yaml offline, visually confirm both files against Steps 1/3.)

- [ ] **Step 6: Commit**

```bash
git -C H:/dev/allowance add deploy/compose.yml deploy/.env.example docker-compose.yml .env.docker.example
git -C H:/dev/allowance commit -m "feat(deploy): image-based family compose + reconcile secrets to auto-generate"
```

---

## Task 3: Docs — lead with prebuilt path + maintainer publish runbook + pre-publish secret scan

**Files:**
- Modify: `SETUP-NEW-HOUSEHOLD.md`

**Interfaces:**
- Consumes: `deploy/compose.yml` + `deploy/.env.example` (Task 2); the image from Task 1.
- Produces: the family-facing quick start and the one-time maintainer publish steps.

- [ ] **Step 1: Add a "Quick start (prebuilt image)" section** as the FIRST path in `SETUP-NEW-HOUSEHOLD.md`, immediately after the intro/"What you need" section and BEFORE the current "Path A — Docker" heading. Insert:

```markdown
## Quick start (prebuilt image — recommended)

No cloning or building — just Docker and two small files.

1. **Install Docker** (Docker Desktop, or Docker Engine on Linux).
2. **Download the two files** into an empty folder:
   ```sh
   curl -O https://raw.githubusercontent.com/mowngle/allowance/main/deploy/compose.yml
   curl -O https://raw.githubusercontent.com/mowngle/allowance/main/deploy/.env.example
   cp .env.example .env
   ```
3. **Set your address** in `.env`: find this machine's LAN IP (Windows `ipconfig`;
   macOS/Linux `ip addr`) and set `ORIGIN=http://<that-ip>:3000`. Leave the secret lines
   blank — they generate themselves on first boot.
4. **Start it:**
   ```sh
   docker compose up -d
   ```
   First start pulls the image, creates the database, and generates this household's
   own secrets. Your data lives in the `allowance-data` volume.
5. **Open** `http://<your-ip>:3000` and continue to [First-run setup](#first-run-setup).

**Update later:** `docker compose pull && docker compose up -d`.
```

- [ ] **Step 2: Demote the existing build/manual paths to "Advanced."** Change the existing heading `## Path A — Docker (recommended)` to `## Advanced: build from source (Docker)` and `## Path B — Manual (Node.js, no Docker)` to `## Advanced: manual (Node.js)`. In the build-from-source section, remove the now-obsolete `gen-secrets` step (secrets auto-generate): delete the step that runs `docker compose run --rm app node scripts/gen-secrets.js` and its surrounding "paste into .env" sentence, and note "secrets auto-generate on first boot — leave them blank." (The manual Node path keeps `npm run gen-secrets` since it has no first-boot container.)

- [ ] **Step 3: Add a maintainer publish runbook** at the END of `SETUP-NEW-HOUSEHOLD.md`:

```markdown
---

## Publishing updates (maintainer only)

The prebuilt image is built and pushed automatically by GitHub Actions
(`.github/workflows/docker-publish.yml`).

- **First-time setup:** create a **public** repo at `github.com/mowngle/allowance`,
  then `git push -u origin main`. The workflow runs on push and publishes
  `ghcr.io/mowngle/allowance:latest`. After the first run, open the repo's
  **Packages**, find `allowance`, and confirm its visibility is **Public** (so families
  pull without a login).
- **Cut a version:** `git tag v0.1.0 && git push origin v0.1.0` — publishes an
  immutable `:v0.1.0` image alongside `:latest`.
- Families on `:latest` get updates with `docker compose pull && docker compose up -d`.
```

- [ ] **Step 4: Pre-publish secret scan** (the repo is about to go public — confirm nothing sensitive is tracked)

Run:
```bash
cd H:/dev/allowance
echo "=== tracked env/db files (expect ONLY *.example) ===" 
git ls-files | grep -iE "(^|/)\.env|\.db$" || echo "(none)"
echo "=== scan tracked files for obvious secret material ==="
git grep -nIE "PRIVATE KEY|BEGIN RSA|SESSION_SECRET=.+|password=|AKIA[0-9A-Z]{16}" -- . ':(exclude)*.example' ':(exclude)docs/**' || echo "(no obvious secrets)"
```
Expected: the first list shows only `.env.example` / `.env.docker.example` / `deploy/.env.example` (never a real `.env` or `*.db`); the second shows `(no obvious secrets)`. If anything real shows up, STOP and report it — do not proceed to publish.

- [ ] **Step 5: Commit**

```bash
git -C H:/dev/allowance add SETUP-NEW-HOUSEHOLD.md
git -C H:/dev/allowance commit -m "docs: lead with prebuilt-image quick start; add maintainer publish runbook"
```

---

## Manual launch steps (yours, after the plan is implemented)

These need your GitHub account and cannot be done by an implementer:
1. Create the **public** repo `github.com/mowngle/allowance`, add it as `origin`, `git push -u origin main`.
2. Watch the Actions run succeed; confirm the GHCR `allowance` package is **Public**.
3. (Optional) Tag `v0.1.0` for a pinned release.
4. Hand a family the two `deploy/` raw URLs (already in the quick start).

---

## Self-Review (completed during authoring)

- **Spec coverage:** C1 workflow → Task 1. C2 family artifacts → Task 2 Steps 1–2. C3 auto-gen (writable mount) → Task 2 Step 3 + `deploy/compose.yml`. C3a reconcile existing files → Task 2 Steps 3–4. C4 docs → Task 3 Steps 1–2; maintainer runbook → Task 3 Step 3; pre-publish secret scan → Task 3 Step 4. Owner one-time steps → "Manual launch steps" + Task 3 Step 3.
- **Placeholder scan:** none — `mowngle` is concrete throughout; no TBDs. The "launch-time" CI build is explicitly a manual/CI gate, not an unfilled step.
- **Type/value consistency:** image ref `ghcr.io/mowngle/allowance` identical in workflow (`${{ github.repository_owner }}` → `mowngle`), `deploy/compose.yml`, and docs; `DATABASE_URL=/data/app.db`, `/data` volume, and writable `.env` mount consistent across `deploy/compose.yml`, the reconciled `docker-compose.yml`, and the auto-gen requirement; tag set (`latest`/`v*`/sha) matches the spec.
- **Verification honesty:** every local check is runnable without Docker/GitHub (YAML parse, grep, secret scan). The image-build/family-run verification is called out as a launch-time gate, not claimed as done.
