# Setting up the Allowance app for your household

This app is **self-hosted**: each family runs its own private copy on a machine in
their own home. Your family's chores, money, and data never leave that machine. The
only thing shared between households is a small cloud "scoreboard" used for the
cross-home leaderboard — and you connect to it with a **Friend Code**, not by exposing
your app.

So to join another family's leaderboard you need two things: **(1)** your own copy of
this app running at home, and **(2)** to exchange Friend Codes once both are up.

You do **not** need a Cloudflare account or any cloud service of your own — you reuse
the existing scoreboard. You only need the scoreboard URL (your friend will give it to
you; it looks like `https://allowance-scoreboard.<name>.workers.dev`).

---

## What you need

- A computer that's **on when your family uses the app** (a desktop, a mini-PC, a
  Raspberry Pi 4/5, etc.). Phones and tablets just open it in a browser; they don't
  host it.
- **Docker** (for the recommended and build paths) **or Node.js 20+** (for the manual path).
- For the **recommended** path, nothing else — you just download two files (below). The **Advanced** paths instead clone the public repo `github.com/mowngle/allowance`.

> **Tip:** give the host machine a **fixed IP** in your router (a "DHCP reservation").
> Everyone's bookmarks and the app's security setting depend on the address not
> changing.

---

## Quick start (prebuilt image — recommended)

No cloning or building — just Docker and two small files.

**Fastest — one command (Linux/macOS):**
```sh
curl -fsSL https://raw.githubusercontent.com/mowngle/allowance/main/deploy/bootstrap.sh | sh
```
This does steps 1–4 below for you (downloads the files, sets `ORIGIN` from your LAN address,
and launches). Prefer to see each step? Follow the manual version:

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

---

## Advanced: build from source (Docker)

**0. Get the source**
```sh
git clone https://github.com/mowngle/allowance
cd allowance
```

**1. Create your config file**
```sh
cp .env.docker.example .env
```

**2. Build the image**
```sh
docker compose build
```

**3. Set your address** in `.env`
Find this machine's LAN IP (Windows: `ipconfig`; macOS/Linux: `ifconfig` or `ip addr`)
— e.g. `192.168.1.50` — and set:
```
ORIGIN=http://192.168.1.50:3000
```
This **must** match the address you actually open in the browser, or logins are
rejected (a SvelteKit cross-site safety check). Leave the secret lines blank —
secrets auto-generate on first boot.

**4. Start it**
```sh
docker compose up -d
```
The first start automatically creates the database, applies migrations, and generates
this household's own secrets. Your data lives in a Docker volume (`allowance-data`)
and survives restarts and upgrades.

**5. Open it:** `http://192.168.1.50:3000` (use *your* IP). Continue to
[First-run setup](#first-run-setup) below.

**Updating later:**
```sh
git pull
docker compose build
docker compose up -d
```
Your data volume is untouched by rebuilds.

---

## Advanced: manual (Node.js)

**1. Install dependencies**
```sh
npm install
```

**2. Create and fill in `.env`**
```sh
cp .env.docker.example .env
npm run gen-secrets   # paste the 4 lines into .env
```
(That's the root `.env.docker.example` template — used when running Node directly, not the `deploy/.env.example` from the quick start.)
Then in `.env` set your address and a **local** database path:
```
ORIGIN=http://192.168.1.50:3000
DATABASE_URL=./allowance.db
```

**3. Set up the database, build, and run**
```sh
npm run db:migrate
npm run build
node -r dotenv/config build
```
The app listens on port 3000 and binds to your whole LAN. To keep it running after you
close the terminal, use a process manager (PM2: `pm2 start "node -r dotenv/config build"
--name allowance`) or install it as a service.

**4. Open it:** `http://192.168.1.50:3000` and continue below.

**Updating later:** `git pull && npm install && npm run db:migrate && npm run build`,
then restart the server.

---

## First-run setup

In the app (on the host machine or any device on your home network):

1. **Onboard your family** — create your family, add each kid with their birthdate,
   claim your devices, and set a parent PIN.
2. Add your chores and start using it day to day. The leaderboard already works for
   **just your household** — no rival needed.

---

## Connecting to another household (the leaderboard)

Once both families have their apps running:

1. As a **parent**, open **Rivals** (PIN-gated).
2. Paste the **scoreboard URL** your friend gave you
   (`https://allowance-scoreboard.<name>.workers.dev`) and **Connect**. This registers
   your household and shows **your Friend Code**.
3. **Share your Friend Code** with the other family (text/email).
4. One side enters the other's Friend Code to **request** a link; the owner **approves**
   it on their own Rivals page. (A code only *requests* — nothing connects until the
   owner approves, so a shared code is safe.)
5. Open **Leaderboard** — both households now appear, with the House Cup and cheer wall.

Either family can leave a rivalry at any time from the Rivals page.

---

## Backups

Your whole world is the SQLite database.
- **Docker:** it's in the `allowance-data` volume. Copy it out with
  `docker compose cp app:/data/app.db ./app-backup.db` (or back up the named volume).
- **Manual:** it's the `DATABASE_URL` file (e.g. `./allowance.db`); `npm run db:backup`
  also writes a JSON snapshot of the ledger.

---

## Troubleshooting

- **"Cross-site POST form submissions are forbidden" on login** → `ORIGIN` doesn't match
  the URL you're visiting. Set `ORIGIN` to exactly the address in your browser's bar
  (scheme + IP + port) and restart.
- **Can't reach it from a phone** → use the host's LAN IP, not `localhost`; make sure
  both devices are on the same network and the host firewall allows inbound port 3000.
- **Leaderboard says "can't reach the scoreboard"** → the cloud scoreboard was briefly
  unreachable; your local app keeps working and it recovers on its own. Check the
  scoreboard URL on the Rivals page is correct.

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
