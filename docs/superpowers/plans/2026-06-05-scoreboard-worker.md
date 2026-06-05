# Scoreboard Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone Cloudflare Worker + KV service that stores per-family scoreboard summaries, manages the mutual/non-transitive Friend-Code rivalry graph, and serves each family a league-scoped leaderboard and cheer feed.

**Architecture:** A single module Worker routes JSON HTTP requests. State lives entirely in one KV namespace (`SCOREBOARD`) as small JSON blobs keyed by house. Every request except `/health` and `/register` is authenticated by a per-house bearer token (only a SHA-256 hash is stored). Reads are authorized against the league graph: a house only ever receives data for itself plus houses it is mutually linked with.

**Tech Stack:** Cloudflare Workers (module syntax), Workers KV, Wrangler, Web Crypto API, TypeScript, Vitest with `@cloudflare/vitest-pool-workers` (Miniflare-backed KV + `SELF.fetch` integration testing).

**Reference spec:** `docs/superpowers/specs/2026-06-05-cross-home-leaderboard-design.md` (§2 KV keys, §4 summary payload, §5 pairing, §7 cheers, §8 trust).

---

## File Structure

The Worker is a separate deployable living under `worker/` (its own `package.json`, isolated from the SvelteKit app's deps).

```
worker/
  wrangler.toml          # Worker name, main entry, KV binding
  package.json           # Worker-only deps (wrangler, vitest, pool)
  tsconfig.json          # Worker TS config
  vitest.config.ts       # Wires vitest-pool-workers to wrangler.toml
  src/
    types.ts             # Env binding + KV data shapes
    lib.ts               # json(), KV JSON get/put, crypto + friend-code helpers
    auth.ts              # authenticate(), withAuth() wrapper
    handlers.ts          # one function per endpoint + link graph helpers
    index.ts            # fetch() router
  test/
    env.d.ts             # cloudflare:test ProvidedEnv typing
    helpers.ts           # registerHouse(), authedFetch() test utilities
    lib.test.ts          # unit tests for crypto/code helpers
    register.test.ts     # POST /register
    summary.test.ts      # auth + POST /summary
    links.test.ts        # request/requests/approve/decline/leave
    cheer.test.ts        # POST /cheer (capped)
    board.test.ts        # GET /board (league-scoped + authorized)
```

### KV key map (from spec §2)

| Key | Value |
|-----|-------|
| `house:<houseId>` | `{ id, name, tokenHash, friendCode, createdAt }` |
| `friendcode:<CODE>` | `houseId` (string) |
| `summary:<houseId>` | `Summary` blob (spec §4) |
| `links:<houseId>` | `string[]` of linked houseIds |
| `requests:<houseId>` | `LinkRequest[]` pending incoming |
| `cheers:<houseId>` | `Cheer[]` capped to last 50 |

### HTTP API (the contract the app plan codes against)

| Method | Path | Auth | Body | Returns |
|--------|------|------|------|---------|
| GET | `/health` | no | – | `{ ok: true }` |
| POST | `/register` | no | `{ name }` | `{ houseId, token, friendCode }` |
| POST | `/summary` | yes | `{ weekStarting, kids[] }` | `{ ok: true }` |
| POST | `/cheer` | yes | `{ fromName, avatar, phraseId }` | `{ ok: true }` |
| GET | `/board` | yes | – | `{ houses: Summary[], cheers: Cheer[] }` |
| GET | `/requests` | yes | – | `{ requests: LinkRequest[] }` |
| POST | `/link-request` | yes | `{ friendCode }` | `{ ok: true, pending: true }` |
| POST | `/link-approve` | yes | `{ fromHouseId }` | `{ ok: true }` |
| POST | `/link-decline` | yes | `{ fromHouseId }` | `{ ok: true }` |
| POST | `/leave` | yes | `{ houseId }` | `{ ok: true }` |

Auth headers on protected routes: `X-House-Id: <houseId>` and `Authorization: Bearer <token>`.

---

## Task 1: Worker scaffold + Vitest tooling

**Files:**
- Create: `worker/package.json`
- Create: `worker/wrangler.toml`
- Create: `worker/tsconfig.json`
- Create: `worker/vitest.config.ts`
- Create: `worker/src/index.ts`
- Create: `worker/test/env.d.ts`
- Test: `worker/test/health.test.ts`

- [ ] **Step 1: Initialize git at the repo root (first commit infra)**

The project is not yet a git repo. From `H:\dev\allowance`:

Run:
```bash
git init
printf "node_modules/\n.svelte-kit/\nbuild/\n*.db\n*.db-*\nworker/node_modules/\nworker/.wrangler/\n.dev.vars\n" >> .gitignore
git add .gitignore
git commit -m "chore: git init"
```

(`.gitignore` already exists with app entries; this appends worker entries. Duplicate lines are harmless.)

- [ ] **Step 2: Create `worker/package.json`**

```json
{
  "name": "allowance-scoreboard",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.2",
    "@cloudflare/workers-types": "^4.20240909.0",
    "typescript": "^5.4.0",
    "vitest": "2.0.5",
    "wrangler": "^3.78.0"
  }
}
```

- [ ] **Step 3: Create `worker/wrangler.toml`**

```toml
name = "allowance-scoreboard"
main = "src/index.ts"
compatibility_date = "2024-09-23"

# For local tests the KV namespace is simulated by vitest-pool-workers, so this
# placeholder id is fine. Replace with the real id from `wrangler kv namespace
# create` before `wrangler deploy` (see Task 8).
[[kv_namespaces]]
binding = "SCOREBOARD"
id = "0000000000000000000000000000000000"
```

- [ ] **Step 4: Create `worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 5: Create `worker/vitest.config.ts`**

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
```

- [ ] **Step 6: Create `worker/test/env.d.ts`** (types for the `cloudflare:test` module)

```ts
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    SCOREBOARD: KVNamespace;
  }
}
```

- [ ] **Step 7: Create the failing test `worker/test/health.test.ts`**

```ts
import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await SELF.fetch('https://sb.test/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 8: Install deps and run the test to confirm it fails**

Run (from `worker/`):
```bash
npm install
npm test
```
Expected: FAIL — `src/index.ts` has no default export / 404, so the assertion on `{ ok: true }` fails (or the worker fails to load).

- [ ] **Step 9: Create minimal `worker/src/index.ts` to pass**

```ts
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  },
};
```

- [ ] **Step 10: Run the test to confirm it passes**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 11: Commit**

```bash
git add worker/
git commit -m "feat(worker): scaffold scoreboard worker with health endpoint and vitest"
```

---

## Task 2: Types + library helpers (crypto, friend codes, KV JSON, json response)

**Files:**
- Create: `worker/src/types.ts`
- Create: `worker/src/lib.ts`
- Test: `worker/test/lib.test.ts`

- [ ] **Step 1: Create `worker/src/types.ts`**

```ts
export interface Env {
  SCOREBOARD: KVNamespace;
}

export interface House {
  id: string;
  name: string;
  tokenHash: string;
  friendCode: string;
  createdAt: number;
}

export interface SummaryKid {
  name: string;
  avatar: string;
  pct: number;
  streak: number;
  choresDone: number;
  badges: string[];
}

export interface Summary {
  houseId: string;
  house: string;
  weekStarting: string;
  kids: SummaryKid[];
  updatedAt: number;
}

export interface Cheer {
  fromHouseId: string;
  fromHouse: string;
  fromName: string;
  avatar: string;
  phraseId: string;
  ts: number;
}

export interface LinkRequest {
  fromHouseId: string;
  fromName: string;
  ts: number;
}
```

- [ ] **Step 2: Write the failing test `worker/test/lib.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { sha256Hex, randomToken, friendCodeFor, json } from '../src/lib';

describe('lib helpers', () => {
  it('sha256Hex is deterministic 64-char hex', async () => {
    const a = await sha256Hex('hello');
    const b = await sha256Hex('hello');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex('world')).not.toBe(a);
  });

  it('randomToken is 64-char hex and unique', () => {
    const t1 = randomToken();
    const t2 = randomToken();
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t1).not.toBe(t2);
  });

  it('friendCodeFor uses an uppercase name slug and avoids ambiguous chars', () => {
    const code = friendCodeFor('Smith Family!');
    expect(code).toMatch(/^SMITH-[A-Z0-9]{4}$/);
    // No ambiguous characters in the random suffix.
    expect(code.split('-')[1]).not.toMatch(/[IO01]/);
  });

  it('friendCodeFor falls back to FAM for empty slugs', () => {
    expect(friendCodeFor('123')).toMatch(/^FAM-[A-Z0-9]{4}$/);
  });

  it('json() builds a JSON Response with status', async () => {
    const res = json({ a: 1 }, 418);
    expect(res.status).toBe(418);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ a: 1 });
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `npm test -- lib`
Expected: FAIL — `../src/lib` does not exist.

- [ ] **Step 4: Create `worker/src/lib.ts`**

```ts
// Friend-code alphabet: no I, O, 0, 1 to avoid confusion when read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function randomCode(len = 4): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function friendCodeFor(name: string): string {
  const slug = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'FAM';
  return `${slug}-${randomCode(4)}`;
}

export async function getJSON<T>(kv: KVNamespace, key: string): Promise<T | null> {
  return (await kv.get(key, 'json')) as T | null;
}

export async function putJSON(kv: KVNamespace, key: string, value: unknown): Promise<void> {
  await kv.put(key, JSON.stringify(value));
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm test -- lib`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/types.ts worker/src/lib.ts worker/test/lib.test.ts
git commit -m "feat(worker): add types and crypto/friend-code/KV helpers"
```

---

## Task 3: `POST /register` + router wiring

**Files:**
- Create: `worker/src/handlers.ts`
- Modify: `worker/src/index.ts` (full rewrite below)
- Test: `worker/test/register.test.ts`
- Create: `worker/test/helpers.ts`

- [ ] **Step 1: Create the shared test helper `worker/test/helpers.ts`**

```ts
import { SELF } from 'cloudflare:test';

export interface Creds {
  houseId: string;
  token: string;
  friendCode: string;
}

export async function registerHouse(name: string): Promise<Creds> {
  const res = await SELF.fetch('https://sb.test/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (res.status !== 200) throw new Error(`register failed: ${res.status}`);
  return (await res.json()) as Creds;
}

export function authHeaders(creds: Creds): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-House-Id': creds.houseId,
    Authorization: `Bearer ${creds.token}`,
  };
}

export async function authedFetch(
  creds: Creds,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return SELF.fetch(`https://sb.test${path}`, {
    ...init,
    headers: { ...authHeaders(creds), ...(init.headers as Record<string, string>) },
  });
}
```

- [ ] **Step 2: Write the failing test `worker/test/register.test.ts`**

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { registerHouse } from './helpers';
import type { House } from '../src/types';

describe('POST /register', () => {
  it('creates a house and returns credentials', async () => {
    const creds = await registerHouse('Smith');
    expect(creds.houseId).toMatch(/^h_/);
    expect(creds.token).toMatch(/^[0-9a-f]{64}$/);
    expect(creds.friendCode).toMatch(/^SMITH-[A-Z0-9]{4}$/);
  });

  it('persists the house and a friend-code reverse lookup, storing only a token hash', async () => {
    const creds = await registerHouse('Jones');
    const house = (await env.SCOREBOARD.get(`house:${creds.houseId}`, 'json')) as House;
    expect(house.name).toBe('Jones');
    expect(house.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(house.tokenHash).not.toBe(creds.token); // hash stored, not the token
    const reverse = await env.SCOREBOARD.get(`friendcode:${creds.friendCode}`);
    expect(reverse).toBe(creds.houseId);
    // links and requests initialized empty
    expect(await env.SCOREBOARD.get(`links:${creds.houseId}`, 'json')).toEqual([]);
    expect(await env.SCOREBOARD.get(`requests:${creds.houseId}`, 'json')).toEqual([]);
  });

  it('rejects a missing name', async () => {
    const res = await (await import('cloudflare:test')).SELF.fetch('https://sb.test/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `npm test -- register`
Expected: FAIL — no `/register` route, returns 404.

- [ ] **Step 4: Create `worker/src/handlers.ts` with the register handler**

```ts
import type { Env, House } from './types';
import { json, sha256Hex, randomToken, friendCodeFor, putJSON } from './lib';

export async function register(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  if (!body || typeof body.name !== 'string' || body.name.trim() === '') {
    return json({ error: 'name required' }, 400);
  }
  const name = body.name.trim();
  const id = `h_${crypto.randomUUID()}`;
  const token = randomToken();
  const tokenHash = await sha256Hex(token);

  // Allocate a unique friend code (retry on the rare collision).
  let friendCode = '';
  for (let i = 0; i < 10; i++) {
    const candidate = friendCodeFor(name);
    const taken = await env.SCOREBOARD.get(`friendcode:${candidate}`);
    if (!taken) {
      friendCode = candidate;
      break;
    }
  }
  if (!friendCode) return json({ error: 'could not allocate friend code' }, 500);

  const house: House = { id, name, tokenHash, friendCode, createdAt: Date.now() };
  await putJSON(env.SCOREBOARD, `house:${id}`, house);
  await env.SCOREBOARD.put(`friendcode:${friendCode}`, id);
  await putJSON(env.SCOREBOARD, `links:${id}`, []);
  await putJSON(env.SCOREBOARD, `requests:${id}`, []);

  return json({ houseId: id, token, friendCode });
}
```

- [ ] **Step 5: Rewrite `worker/src/index.ts` as the router**

```ts
import type { Env } from './types';
import { json } from './lib';
import { register } from './handlers';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'GET' && path === '/health') return json({ ok: true });
    if (method === 'POST' && path === '/register') return register(request, env);

    return json({ error: 'not found' }, 404);
  },
};
```

- [ ] **Step 6: Run register + health tests to confirm they pass**

Run: `npm test -- register health`
Expected: PASS (health 1 + register 3 = 4 tests).

- [ ] **Step 7: Commit**

```bash
git add worker/src/handlers.ts worker/src/index.ts worker/test/register.test.ts worker/test/helpers.ts
git commit -m "feat(worker): POST /register issues house id, token, friend code"
```

---

## Task 4: Authentication + `POST /summary`

**Files:**
- Create: `worker/src/auth.ts`
- Modify: `worker/src/handlers.ts` (add `summary`)
- Modify: `worker/src/index.ts` (wire auth + /summary)
- Test: `worker/test/summary.test.ts`

- [ ] **Step 1: Write the failing test `worker/test/summary.test.ts`**

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { registerHouse, authedFetch } from './helpers';
import type { Summary } from '../src/types';

const sampleKids = [
  { name: 'Mia', avatar: '🦊', pct: 92, streak: 6, choresDone: 11, badges: ['perfect-week'] },
];

describe('POST /summary', () => {
  it('rejects requests with no/invalid credentials', async () => {
    const noAuth = await fetch('https://sb.test/summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekStarting: '2026-06-01', kids: sampleKids }),
    }).catch(() => null);
    // fetch() to a non-routable host throws in workerd; assert via SELF instead:
    const { SELF } = await import('cloudflare:test');
    const res = await SELF.fetch('https://sb.test/summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekStarting: '2026-06-01', kids: sampleKids }),
    });
    expect(res.status).toBe(401);
    void noAuth;
  });

  it('rejects a bad token for a real house', async () => {
    const creds = await registerHouse('Smith');
    const res = await authedFetch(
      { ...creds, token: 'deadbeef' },
      '/summary',
      { method: 'POST', body: JSON.stringify({ weekStarting: '2026-06-01', kids: sampleKids }) }
    );
    expect(res.status).toBe(401);
  });

  it('stores the summary for an authenticated house', async () => {
    const creds = await registerHouse('Smith');
    const res = await authedFetch(creds, '/summary', {
      method: 'POST',
      body: JSON.stringify({ weekStarting: '2026-06-01', kids: sampleKids }),
    });
    expect(res.status).toBe(200);
    const stored = (await env.SCOREBOARD.get(`summary:${creds.houseId}`, 'json')) as Summary;
    expect(stored.house).toBe('Smith');
    expect(stored.houseId).toBe(creds.houseId);
    expect(stored.kids[0].name).toBe('Mia');
    expect(typeof stored.updatedAt).toBe('number');
  });

  it('rejects a malformed summary body', async () => {
    const creds = await registerHouse('Smith');
    const res = await authedFetch(creds, '/summary', {
      method: 'POST',
      body: JSON.stringify({ kids: 'nope' }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- summary`
Expected: FAIL — `/summary` route returns 404.

- [ ] **Step 3: Create `worker/src/auth.ts`**

```ts
import type { Env, House } from './types';
import { json, sha256Hex, getJSON } from './lib';

export interface AuthCtx {
  houseId: string;
  house: House;
}

/** Returns AuthCtx on success, or a 401 Response on failure. */
export async function authenticate(request: Request, env: Env): Promise<AuthCtx | Response> {
  const houseId = request.headers.get('X-House-Id');
  const authHeader = request.headers.get('Authorization');
  if (!houseId || !authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'unauthorized' }, 401);
  }
  const token = authHeader.slice('Bearer '.length);
  const house = await getJSON<House>(env.SCOREBOARD, `house:${houseId}`);
  if (!house) return json({ error: 'unauthorized' }, 401);
  const presented = await sha256Hex(token);
  if (presented !== house.tokenHash) return json({ error: 'unauthorized' }, 401);
  return { houseId, house };
}

export type AuthedHandler = (request: Request, env: Env, ctx: AuthCtx) => Promise<Response>;

/** Authenticates, then delegates to the handler with the AuthCtx. */
export async function withAuth(
  request: Request,
  env: Env,
  handler: AuthedHandler
): Promise<Response> {
  const result = await authenticate(request, env);
  if (result instanceof Response) return result;
  return handler(request, env, result);
}
```

- [ ] **Step 4: Add the `summary` handler to `worker/src/handlers.ts`**

Append this function (and extend the imports at the top of the file to include `getJSON` — see note):

```ts
import type { AuthCtx } from './auth';
import type { Summary, SummaryKid } from './types';

export async function summary(request: Request, env: Env, ctx: AuthCtx): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { weekStarting?: unknown; kids?: unknown }
    | null;
  if (!body || typeof body.weekStarting !== 'string' || !Array.isArray(body.kids)) {
    return json({ error: 'bad summary' }, 400);
  }
  const record: Summary = {
    houseId: ctx.houseId,
    house: ctx.house.name,
    weekStarting: body.weekStarting,
    kids: body.kids as SummaryKid[],
    updatedAt: Date.now(),
  };
  await putJSON(env.SCOREBOARD, `summary:${ctx.houseId}`, record);
  return json({ ok: true });
}
```

Note: the existing import line in `handlers.ts` is
`import { json, sha256Hex, randomToken, friendCodeFor, putJSON } from './lib';`
— leave it as is; `summary` only needs `json` and `putJSON`, both already imported.

- [ ] **Step 5: Wire auth + /summary into `worker/src/index.ts`**

```ts
import type { Env } from './types';
import { json } from './lib';
import { withAuth } from './auth';
import { register, summary } from './handlers';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'GET' && path === '/health') return json({ ok: true });
    if (method === 'POST' && path === '/register') return register(request, env);

    if (method === 'POST' && path === '/summary') return withAuth(request, env, summary);

    return json({ error: 'not found' }, 404);
  },
};
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `npm test -- summary`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add worker/src/auth.ts worker/src/handlers.ts worker/src/index.ts worker/test/summary.test.ts
git commit -m "feat(worker): bearer-token auth and POST /summary storage"
```

---

## Task 5: Friend-code link lifecycle (request / list / approve / decline)

**Files:**
- Modify: `worker/src/handlers.ts` (add `linkRequest`, `listRequests`, `linkApprove`, `linkDecline`, `addLink`)
- Modify: `worker/src/index.ts` (wire routes)
- Test: `worker/test/links.test.ts`

- [ ] **Step 1: Write the failing test `worker/test/links.test.ts`**

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { registerHouse, authedFetch } from './helpers';
import type { LinkRequest } from '../src/types';

describe('link lifecycle', () => {
  it('link-request queues a pending request on the target, not a link', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');

    const res = await authedFetch(b, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: a.friendCode }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, pending: true });

    const reqs = (await env.SCOREBOARD.get(`requests:${a.houseId}`, 'json')) as LinkRequest[];
    expect(reqs).toHaveLength(1);
    expect(reqs[0].fromHouseId).toBe(b.houseId);
    expect(reqs[0].fromName).toBe('Bravo');
    // No edge yet.
    expect(await env.SCOREBOARD.get(`links:${a.houseId}`, 'json')).toEqual([]);
    expect(await env.SCOREBOARD.get(`links:${b.houseId}`, 'json')).toEqual([]);
  });

  it('rejects an unknown friend code and self-linking', async () => {
    const a = await registerHouse('Alpha');
    const unknown = await authedFetch(a, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: 'NOPE-9999' }),
    });
    expect(unknown.status).toBe(404);

    const self = await authedFetch(a, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: a.friendCode }),
    });
    expect(self.status).toBe(400);
  });

  it('GET /requests lists pending incoming requests', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');
    await authedFetch(b, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: a.friendCode }),
    });
    const res = await authedFetch(a, '/requests');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requests: LinkRequest[] };
    expect(body.requests[0].fromHouseId).toBe(b.houseId);
  });

  it('approve creates a mutual edge and clears the request', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');
    await authedFetch(b, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: a.friendCode }),
    });
    const res = await authedFetch(a, '/link-approve', {
      method: 'POST',
      body: JSON.stringify({ fromHouseId: b.houseId }),
    });
    expect(res.status).toBe(200);
    expect(await env.SCOREBOARD.get(`links:${a.houseId}`, 'json')).toEqual([b.houseId]);
    expect(await env.SCOREBOARD.get(`links:${b.houseId}`, 'json')).toEqual([a.houseId]);
    expect(await env.SCOREBOARD.get(`requests:${a.houseId}`, 'json')).toEqual([]);
  });

  it('approve with no matching request 404s', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');
    const res = await authedFetch(a, '/link-approve', {
      method: 'POST',
      body: JSON.stringify({ fromHouseId: b.houseId }),
    });
    expect(res.status).toBe(404);
  });

  it('decline drops the request without linking', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');
    await authedFetch(b, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: a.friendCode }),
    });
    const res = await authedFetch(a, '/link-decline', {
      method: 'POST',
      body: JSON.stringify({ fromHouseId: b.houseId }),
    });
    expect(res.status).toBe(200);
    expect(await env.SCOREBOARD.get(`requests:${a.houseId}`, 'json')).toEqual([]);
    expect(await env.SCOREBOARD.get(`links:${a.houseId}`, 'json')).toEqual([]);
  });

  it('link-request is idempotent and refuses an already-linked house', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');
    // Duplicate request → still one pending entry.
    await authedFetch(b, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: a.friendCode }),
    });
    await authedFetch(b, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: a.friendCode }),
    });
    const reqs = (await env.SCOREBOARD.get(`requests:${a.houseId}`, 'json')) as LinkRequest[];
    expect(reqs).toHaveLength(1);
    // After approval, a new request is refused with 409.
    await authedFetch(a, '/link-approve', {
      method: 'POST',
      body: JSON.stringify({ fromHouseId: b.houseId }),
    });
    const again = await authedFetch(b, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: a.friendCode }),
    });
    expect(again.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- links`
Expected: FAIL — link routes return 404.

- [ ] **Step 3: Add the link handlers to `worker/src/handlers.ts`**

Append. Extend the lib import to add `getJSON` (change the existing import line to include it):

```ts
// Change the top import in handlers.ts to:
// import { json, sha256Hex, randomToken, friendCodeFor, putJSON, getJSON } from './lib';
import type { LinkRequest } from './types';

async function addLink(env: Env, a: string, b: string): Promise<void> {
  const key = `links:${a}`;
  const list = (await getJSON<string[]>(env.SCOREBOARD, key)) ?? [];
  if (!list.includes(b)) {
    list.push(b);
    await putJSON(env.SCOREBOARD, key, list);
  }
}

export async function linkRequest(request: Request, env: Env, ctx: AuthCtx): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { friendCode?: unknown } | null;
  if (!body || typeof body.friendCode !== 'string') {
    return json({ error: 'friendCode required' }, 400);
  }
  const targetId = await env.SCOREBOARD.get(`friendcode:${body.friendCode.toUpperCase()}`);
  if (!targetId) return json({ error: 'unknown friend code' }, 404);
  if (targetId === ctx.houseId) return json({ error: 'cannot link to yourself' }, 400);

  const links = (await getJSON<string[]>(env.SCOREBOARD, `links:${ctx.houseId}`)) ?? [];
  if (links.includes(targetId)) return json({ error: 'already linked' }, 409);

  const key = `requests:${targetId}`;
  const reqs = (await getJSON<LinkRequest[]>(env.SCOREBOARD, key)) ?? [];
  if (!reqs.some((r) => r.fromHouseId === ctx.houseId)) {
    reqs.push({ fromHouseId: ctx.houseId, fromName: ctx.house.name, ts: Date.now() });
    await putJSON(env.SCOREBOARD, key, reqs);
  }
  return json({ ok: true, pending: true });
}

export async function listRequests(_request: Request, env: Env, ctx: AuthCtx): Promise<Response> {
  const reqs = (await getJSON<LinkRequest[]>(env.SCOREBOARD, `requests:${ctx.houseId}`)) ?? [];
  return json({ requests: reqs });
}

export async function linkApprove(request: Request, env: Env, ctx: AuthCtx): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { fromHouseId?: unknown } | null;
  if (!body || typeof body.fromHouseId !== 'string') {
    return json({ error: 'fromHouseId required' }, 400);
  }
  const key = `requests:${ctx.houseId}`;
  const reqs = (await getJSON<LinkRequest[]>(env.SCOREBOARD, key)) ?? [];
  if (!reqs.some((r) => r.fromHouseId === body.fromHouseId)) {
    return json({ error: 'no such request' }, 404);
  }
  await addLink(env, ctx.houseId, body.fromHouseId);
  await addLink(env, body.fromHouseId, ctx.houseId);
  await putJSON(env.SCOREBOARD, key, reqs.filter((r) => r.fromHouseId !== body.fromHouseId));
  return json({ ok: true });
}

export async function linkDecline(request: Request, env: Env, ctx: AuthCtx): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { fromHouseId?: unknown } | null;
  if (!body || typeof body.fromHouseId !== 'string') {
    return json({ error: 'fromHouseId required' }, 400);
  }
  const key = `requests:${ctx.houseId}`;
  const reqs = (await getJSON<LinkRequest[]>(env.SCOREBOARD, key)) ?? [];
  await putJSON(env.SCOREBOARD, key, reqs.filter((r) => r.fromHouseId !== body.fromHouseId));
  return json({ ok: true });
}
```

- [ ] **Step 4: Wire the routes into `worker/src/index.ts`**

```ts
import type { Env } from './types';
import { json } from './lib';
import { withAuth } from './auth';
import {
  register,
  summary,
  linkRequest,
  listRequests,
  linkApprove,
  linkDecline,
} from './handlers';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'GET' && path === '/health') return json({ ok: true });
    if (method === 'POST' && path === '/register') return register(request, env);

    if (method === 'POST' && path === '/summary') return withAuth(request, env, summary);
    if (method === 'GET' && path === '/requests') return withAuth(request, env, listRequests);
    if (method === 'POST' && path === '/link-request') return withAuth(request, env, linkRequest);
    if (method === 'POST' && path === '/link-approve') return withAuth(request, env, linkApprove);
    if (method === 'POST' && path === '/link-decline') return withAuth(request, env, linkDecline);

    return json({ error: 'not found' }, 404);
  },
};
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm test -- links`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/handlers.ts worker/src/index.ts worker/test/links.test.ts
git commit -m "feat(worker): friend-code link request/approve/decline lifecycle"
```

---

## Task 6: `POST /leave`

**Files:**
- Modify: `worker/src/handlers.ts` (add `leave`, `removeLink`)
- Modify: `worker/src/index.ts` (wire route)
- Test: `worker/test/links.test.ts` (add a describe block)

- [ ] **Step 1: Add the failing test to `worker/test/links.test.ts`**

Append this block inside the file (after the existing `describe`):

```ts
describe('POST /leave', () => {
  it('removes the edge on both sides', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');
    await authedFetch(b, '/link-request', {
      method: 'POST',
      body: JSON.stringify({ friendCode: a.friendCode }),
    });
    await authedFetch(a, '/link-approve', {
      method: 'POST',
      body: JSON.stringify({ fromHouseId: b.houseId }),
    });

    const res = await authedFetch(a, '/leave', {
      method: 'POST',
      body: JSON.stringify({ houseId: b.houseId }),
    });
    expect(res.status).toBe(200);
    expect(await env.SCOREBOARD.get(`links:${a.houseId}`, 'json')).toEqual([]);
    expect(await env.SCOREBOARD.get(`links:${b.houseId}`, 'json')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm test -- links`
Expected: FAIL — `/leave` returns 404.

- [ ] **Step 3: Add `leave` + `removeLink` to `worker/src/handlers.ts`**

```ts
async function removeLink(env: Env, a: string, b: string): Promise<void> {
  const key = `links:${a}`;
  const list = (await getJSON<string[]>(env.SCOREBOARD, key)) ?? [];
  await putJSON(env.SCOREBOARD, key, list.filter((x) => x !== b));
}

export async function leave(request: Request, env: Env, ctx: AuthCtx): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { houseId?: unknown } | null;
  if (!body || typeof body.houseId !== 'string') {
    return json({ error: 'houseId required' }, 400);
  }
  await removeLink(env, ctx.houseId, body.houseId);
  await removeLink(env, body.houseId, ctx.houseId);
  return json({ ok: true });
}
```

- [ ] **Step 4: Wire the route in `worker/src/index.ts`**

Add `leave` to the import from `./handlers`, and add this line after the `/link-decline` route:

```ts
    if (method === 'POST' && path === '/leave') return withAuth(request, env, leave);
```

- [ ] **Step 5: Run to confirm it passes**

Run: `npm test -- links`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/handlers.ts worker/src/index.ts worker/test/links.test.ts
git commit -m "feat(worker): POST /leave removes a rivalry on both sides"
```

---

## Task 7: `POST /cheer` (capped feed)

**Files:**
- Modify: `worker/src/handlers.ts` (add `cheer`)
- Modify: `worker/src/index.ts` (wire route)
- Test: `worker/test/cheer.test.ts`

- [ ] **Step 1: Write the failing test `worker/test/cheer.test.ts`**

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { registerHouse, authedFetch } from './helpers';
import type { Cheer } from '../src/types';

describe('POST /cheer', () => {
  it('appends a cheer with worker-stamped house + ts', async () => {
    const a = await registerHouse('Alpha');
    const res = await authedFetch(a, '/cheer', {
      method: 'POST',
      body: JSON.stringify({ fromName: 'Mia', avatar: '🦊', phraseId: 'catch-me' }),
    });
    expect(res.status).toBe(200);
    const list = (await env.SCOREBOARD.get(`cheers:${a.houseId}`, 'json')) as Cheer[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      fromHouseId: a.houseId,
      fromHouse: 'Alpha',
      fromName: 'Mia',
      avatar: '🦊',
      phraseId: 'catch-me',
    });
    expect(typeof list[0].ts).toBe('number');
  });

  it('rejects a cheer missing phraseId or fromName', async () => {
    const a = await registerHouse('Alpha');
    const res = await authedFetch(a, '/cheer', {
      method: 'POST',
      body: JSON.stringify({ fromName: 'Mia' }),
    });
    expect(res.status).toBe(400);
  });

  it('caps the stored feed at 50, keeping the most recent', async () => {
    const a = await registerHouse('Alpha');
    for (let i = 0; i < 55; i++) {
      await authedFetch(a, '/cheer', {
        method: 'POST',
        body: JSON.stringify({ fromName: `K${i}`, avatar: '⭐', phraseId: 'gg' }),
      });
    }
    const list = (await env.SCOREBOARD.get(`cheers:${a.houseId}`, 'json')) as Cheer[];
    expect(list).toHaveLength(50);
    expect(list[0].fromName).toBe('K5'); // first 5 dropped
    expect(list[49].fromName).toBe('K54');
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm test -- cheer`
Expected: FAIL — `/cheer` returns 404.

- [ ] **Step 3: Add the `cheer` handler to `worker/src/handlers.ts`**

```ts
import type { Cheer } from './types';

const CHEER_CAP = 50;

export async function cheer(request: Request, env: Env, ctx: AuthCtx): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { fromName?: unknown; avatar?: unknown; phraseId?: unknown }
    | null;
  if (!body || typeof body.fromName !== 'string' || typeof body.phraseId !== 'string') {
    return json({ error: 'bad cheer' }, 400);
  }
  const key = `cheers:${ctx.houseId}`;
  const list = (await getJSON<Cheer[]>(env.SCOREBOARD, key)) ?? [];
  list.push({
    fromHouseId: ctx.houseId,
    fromHouse: ctx.house.name,
    fromName: body.fromName,
    avatar: typeof body.avatar === 'string' ? body.avatar : '',
    phraseId: body.phraseId,
    ts: Date.now(),
  });
  await putJSON(env.SCOREBOARD, key, list.slice(-CHEER_CAP));
  return json({ ok: true });
}
```

- [ ] **Step 4: Wire the route in `worker/src/index.ts`**

Add `cheer` to the `./handlers` import and add after the `/summary` route:

```ts
    if (method === 'POST' && path === '/cheer') return withAuth(request, env, cheer);
```

- [ ] **Step 5: Run to confirm it passes**

Run: `npm test -- cheer`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/handlers.ts worker/src/index.ts worker/test/cheer.test.ts
git commit -m "feat(worker): POST /cheer appends to a 50-entry capped feed"
```

---

## Task 8: `GET /board` (league-scoped, authorized)

**Files:**
- Modify: `worker/src/handlers.ts` (add `board`)
- Modify: `worker/src/index.ts` (wire route)
- Test: `worker/test/board.test.ts`

- [ ] **Step 1: Write the failing test `worker/test/board.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { registerHouse, authedFetch, type Creds } from './helpers';
import type { Summary, Cheer } from '../src/types';

async function postSummary(creds: Creds, kidName: string, pct: number) {
  await authedFetch(creds, '/summary', {
    method: 'POST',
    body: JSON.stringify({
      weekStarting: '2026-06-01',
      kids: [{ name: kidName, avatar: '🦊', pct, streak: 1, choresDone: 3, badges: [] }],
    }),
  });
}

async function link(a: Creds, b: Creds) {
  // b requests a, a approves.
  await authedFetch(b, '/link-request', {
    method: 'POST',
    body: JSON.stringify({ friendCode: a.friendCode }),
  });
  await authedFetch(a, '/link-approve', {
    method: 'POST',
    body: JSON.stringify({ fromHouseId: b.houseId }),
  });
}

describe('GET /board', () => {
  it('returns only the caller plus linked houses (non-transitive)', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');
    const c = await registerHouse('Charlie');
    await postSummary(a, 'Amy', 90);
    await postSummary(b, 'Ben', 80);
    await postSummary(c, 'Cal', 70);
    await link(a, b); // A<->B
    await link(a, c); // A<->C  (B and C NOT linked)

    // A sees A, B, C.
    const aBoard = (await (await authedFetch(a, '/board')).json()) as { houses: Summary[] };
    const aHouses = aBoard.houses.map((h) => h.house).sort();
    expect(aHouses).toEqual(['Alpha', 'Bravo', 'Charlie']);

    // B sees only A and B — NOT C.
    const bBoard = (await (await authedFetch(b, '/board')).json()) as { houses: Summary[] };
    const bHouses = bBoard.houses.map((h) => h.house).sort();
    expect(bHouses).toEqual(['Alpha', 'Bravo']);
  });

  it('merges and time-sorts cheers across the league', async () => {
    const a = await registerHouse('Alpha');
    const b = await registerHouse('Bravo');
    await postSummary(a, 'Amy', 90);
    await postSummary(b, 'Ben', 80);
    await link(a, b);
    await authedFetch(a, '/cheer', {
      method: 'POST',
      body: JSON.stringify({ fromName: 'Amy', avatar: '🦊', phraseId: 'gg' }),
    });
    await authedFetch(b, '/cheer', {
      method: 'POST',
      body: JSON.stringify({ fromName: 'Ben', avatar: '🐻', phraseId: 'catch-me' }),
    });
    const board = (await (await authedFetch(a, '/board')).json()) as { cheers: Cheer[] };
    expect(board.cheers).toHaveLength(2);
    expect(board.cheers[0].ts).toBeLessThanOrEqual(board.cheers[1].ts);
  });

  it('a lone house sees only itself', async () => {
    const a = await registerHouse('Solo');
    await postSummary(a, 'Sam', 100);
    const board = (await (await authedFetch(a, '/board')).json()) as { houses: Summary[] };
    expect(board.houses.map((h) => h.house)).toEqual(['Solo']);
  });
});
```

Note: this test imports `type Creds` from `./helpers` — that type is already exported there (Task 3, Step 1).

- [ ] **Step 2: Run to confirm it fails**

Run: `npm test -- board`
Expected: FAIL — `/board` returns 404.

- [ ] **Step 3: Add the `board` handler to `worker/src/handlers.ts`**

```ts
import type { Summary } from './types';

export async function board(_request: Request, env: Env, ctx: AuthCtx): Promise<Response> {
  const links = (await getJSON<string[]>(env.SCOREBOARD, `links:${ctx.houseId}`)) ?? [];
  const ids = [ctx.houseId, ...links];

  const houses: Summary[] = [];
  let cheers: Cheer[] = [];
  for (const id of ids) {
    const s = await getJSON<Summary>(env.SCOREBOARD, `summary:${id}`);
    if (s) houses.push(s);
    const c = (await getJSON<Cheer[]>(env.SCOREBOARD, `cheers:${id}`)) ?? [];
    cheers = cheers.concat(c);
  }
  cheers.sort((x, y) => x.ts - y.ts);
  cheers = cheers.slice(-50);

  return json({ houses, cheers });
}
```

(`Summary` and `Cheer` are now both imported in `handlers.ts` from earlier tasks; if your editor flags a duplicate `import type { Summary }`, merge it into the existing `./types` import line rather than adding a second one.)

- [ ] **Step 4: Wire the route in `worker/src/index.ts`**

Add `board` to the `./handlers` import and add after the `/requests` route:

```ts
    if (method === 'GET' && path === '/board') return withAuth(request, env, board);
```

- [ ] **Step 5: Run to confirm it passes**

Run: `npm test -- board`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the FULL suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS — all files green (health, lib, register, summary, links, cheer, board).

- [ ] **Step 7: Commit**

```bash
git add worker/src/handlers.ts worker/src/index.ts worker/test/board.test.ts
git commit -m "feat(worker): GET /board returns league-scoped summaries and cheers"
```

---

## Task 9: Deploy to Cloudflare + smoke test

**Files:**
- Modify: `worker/wrangler.toml` (real KV namespace id)
- Create: `worker/README.md` (deploy + curl runbook)

- [ ] **Step 1: Authenticate Wrangler**

Run (from `worker/`): `npx wrangler login`
Expected: browser opens; CLI prints "Successfully logged in".

- [ ] **Step 2: Create the production KV namespace**

Run: `npx wrangler kv namespace create SCOREBOARD`
Expected: prints a block containing an `id = "..."`. Copy that id.

- [ ] **Step 3: Put the real id in `worker/wrangler.toml`**

Replace the placeholder id:

```toml
[[kv_namespaces]]
binding = "SCOREBOARD"
id = "<paste-the-real-id-here>"
```

- [ ] **Step 4: Deploy**

Run: `npx wrangler deploy`
Expected: prints the deployed URL, e.g. `https://allowance-scoreboard.<subdomain>.workers.dev`.

- [ ] **Step 5: Smoke-test the live worker end-to-end**

Replace `$URL` with the deployed URL. Run each and confirm:

```bash
# health
curl -s $URL/health
# → {"ok":true}

# register two houses
curl -s -XPOST $URL/register -H 'content-type: application/json' -d '{"name":"Alpha"}'
curl -s -XPOST $URL/register -H 'content-type: application/json' -d '{"name":"Bravo"}'
# → each returns {"houseId":"h_…","token":"…","friendCode":"ALPHA-…"}
```

Then, using Alpha's friendCode and Bravo's creds, confirm the link flow returns
`{"ok":true,"pending":true}` for `/link-request`, that `/requests` (as Alpha) lists it,
and that `/link-approve` (as Alpha) returns `{"ok":true}`. Finally `GET /board` as Bravo
should list both Alpha and Bravo. (Document the exact commands you used in the README.)

- [ ] **Step 6: Write `worker/README.md`** capturing: the deployed URL, how to run tests
(`npm test`), how to deploy (`wrangler deploy`), how to rotate the KV id, and the full
smoke-test command sequence you ran in Step 5 (with real headers filled in).

- [ ] **Step 7: Commit**

```bash
git add worker/wrangler.toml worker/README.md
git commit -m "chore(worker): deploy config and runbook for cloudflare scoreboard"
```

> **Security note for the README:** the worker has no per-IP rate limiting in v1. For a
> handful of families this is acceptable, but record it as a known limitation so the app
> plan / future work can revisit (e.g. Cloudflare rate-limiting rules on `/register`).

---

## Self-Review (completed during authoring)

- **Spec coverage:** §2 KV keys → Tasks 3–8 create every listed key. §4 summary payload → Task 4. §5 Friend-Code pairing (request → approve, non-transitive, mutual) → Tasks 5–6 + Task 8's non-transitivity test. §7 cheers (capped, league-scoped) → Tasks 7–8. §8 trust (token auth, graph-authorized reads, no unilateral linking) → Task 4 (auth) + Task 5 (approval required) + Task 8 (read scoping). Friend Code issued at register → Task 3.
- **Placeholders:** none — every code/test step is complete and runnable.
- **Type consistency:** `House`, `Summary`, `SummaryKid`, `Cheer`, `LinkRequest`, `AuthCtx`, and the `Creds` test type are defined once and reused with matching field names across tasks. Handler signatures match the `AuthedHandler` type wired through `withAuth`.
- **Out of scope (handed to the app plan):** computing summaries from the SQLite data, the `/leaderboard` UI, parent settings, storing this instance's `houseId`/token locally, and the cheer phrase set.
```
