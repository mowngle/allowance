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
