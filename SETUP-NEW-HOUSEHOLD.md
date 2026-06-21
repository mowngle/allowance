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
- **Either Docker** (recommended — easiest) **or Node.js 20+** (manual path).
- The app's code (your friend shares a private Git repo to `git clone`, or a zip).

> **Tip:** give the host machine a **fixed IP** in your router (a "DHCP reservation").
> Everyone's bookmarks and the app's security setting depend on the address not
> changing.

---

## Path A — Docker (recommended)

From the project folder:

**1. Create your config file**
```sh
cp .env.docker.example .env
```

**2. Build the image**
```sh
docker compose build
```

**3. Generate your secrets** and paste them into `.env`
```sh
docker compose run --rm app node scripts/gen-secrets.js
```
Copy the four `VAPID_*` / `SESSION_SECRET` lines it prints, and replace the blank
secret lines in your `.env` with them.

**4. Set your address** in `.env`
Find this machine's LAN IP (Windows: `ipconfig`; macOS/Linux: `ifconfig` or `ip addr`)
— e.g. `192.168.1.50` — and set:
```
ORIGIN=http://192.168.1.50:3000
```
This **must** match the address you actually open in the browser, or logins are
rejected (a SvelteKit cross-site safety check).

**5. Start it**
```sh
docker compose up -d
```
The first start automatically creates the database and applies migrations. Your data
lives in a Docker volume (`allowance-data`) and survives restarts and upgrades.

**6. Open it:** `http://192.168.1.50:3000` (use *your* IP). Continue to
[First-run setup](#first-run-setup) below.

**Updating later:**
```sh
git pull
docker compose build
docker compose up -d
```
Your data volume is untouched by rebuilds.

---

## Path B — Manual (Node.js, no Docker)

**1. Install dependencies**
```sh
npm install
```

**2. Create and fill in `.env`**
```sh
cp .env.docker.example .env
npm run gen-secrets   # paste the 4 lines into .env
```
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
