# Allowance Scoreboard Worker

A small Cloudflare Worker + KV service that holds the cross-home leaderboard for the
allowance app. Each family's self-hosted app pushes a summary (consistency %, streak,
badges) and pulls a league-scoped board. Families link via mutual, non-transitive
Friend Codes. No raw chore data or money ever leaves a house — only summary numbers.

See the design + plan: `../docs/superpowers/specs/2026-06-05-cross-home-leaderboard-design.md`
and `../docs/superpowers/plans/2026-06-05-scoreboard-worker.md`.

## Live deployment

- URL: `https://allowance-scoreboard.mowngle.workers.dev`
- KV namespace `SCOREBOARD` id: `d6e027aa4f264662bf065efa7128fef5`
- workers.dev subdomain: `mowngle`

## HTTP API

| Method | Path | Auth | Body | Returns |
|--------|------|------|------|---------|
| GET | `/health` | no | – | `{ ok: true }` |
| POST | `/register` | no | `{ name }` | `{ houseId, token, friendCode }` |
| POST | `/summary` | yes | `{ weekStarting, kids[] }` | `{ ok: true }` |
| POST | `/cheer` | yes | `{ fromName, avatar, phraseId }` | `{ ok: true }` |
| GET | `/board` | yes | – | `{ houses[], cheers[] }` |
| GET | `/requests` | yes | – | `{ requests[] }` |
| POST | `/link-request` | yes | `{ friendCode }` | `{ ok: true, pending: true }` |
| POST | `/link-approve` | yes | `{ fromHouseId }` | `{ ok: true }` |
| POST | `/link-decline` | yes | `{ fromHouseId }` | `{ ok: true }` |
| POST | `/leave` | yes | `{ houseId }` | `{ ok: true }` |

Auth headers on protected routes: `X-House-Id: <houseId>` and
`Authorization: Bearer <token>`. The Worker stores only a SHA-256 hash of the token.
Reads are authorized against the league graph — a house only ever receives data for
itself plus houses it is mutually linked with.

## Develop & test

All tests run locally against a simulated KV (vitest-pool-workers / Miniflare) — no
Cloudflare account needed.

```sh
cd worker
npm install
npm test          # full suite
npm run test:watch
```

## Deploy

Auth uses a **scoped API token** (Workers Scripts: Edit + Workers KV Storage: Edit),
never a broad `wrangler login`. Provide it via env vars so nothing sensitive is stored:

```sh
cd worker
# token kept in a file outside the repo; account id is not a secret
CLOUDFLARE_ACCOUNT_ID=<account-id> \
CLOUDFLARE_API_TOKEN="$(tr -d '\r\n' < /path/to/cf-token.txt)" \
npx wrangler deploy
```

First-time-only account setup (already done for `mowngle`):
- Register a workers.dev subdomain (one-time, account-wide).
- Create the KV namespace and put its id in `wrangler.toml`:
  ```sh
  npx wrangler kv namespace create SCOREBOARD
  ```

## Smoke test (against the live URL)

```sh
BASE=https://allowance-scoreboard.mowngle.workers.dev
curl -s $BASE/health                                              # {"ok":true}
curl -s -XPOST $BASE/register -H 'content-type: application/json' -d '{"name":"Alpha"}'
# → {"houseId","token","friendCode"}; then use those headers for the authed routes:
#   link-request (with another house's friendCode) → /requests → link-approve → /board
```

## Known limitations (v1)

- **No per-IP rate limiting.** Acceptable for a handful of families; revisit with a
  Cloudflare rate-limiting rule on `/register` if the surface ever widens.
- Friend codes are guessable by design (slug from house name); security comes from the
  link-approval flow, not code secrecy.
- KV is eventually consistent and has no transactions; read-modify-write races on the
  link graph are accepted at this scale.
