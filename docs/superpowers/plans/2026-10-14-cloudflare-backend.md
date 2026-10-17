# Cloudflare Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second `Backend` implementation that keeps users, boards, board contents and media on Cloudflare, with anonymous accounts that upgrade to Google.

**Architecture:** A Worker in `worker/` (its own npm package) serves `/api/auth/*` (Better Auth on D1), `/api/*` (boards, previews, assets on D1 + R2) and `/parties/board-room/:id` (one `BoardRoom` Durable Object per board, a y-partyserver Yjs room persisted in the DO's SQLite). The browser keeps its IndexedDB copy of every board and asset as a cache, so boards open instantly and work offline. `main.tsx` chooses the backend from `VITE_BACKEND`.

**Tech Stack:** Cloudflare Workers, D1, R2, Durable Objects; better-auth 1.7.7; partyserver 0.5.10 + y-partyserver 2.2.0 (server); y-websocket 3 (client); wrangler 4.151; @cloudflare/vite-plugin 1.64; @cloudflare/vitest-pool-workers 0.23 (vitest 4, worker package only).

**Spec:** `docs/superpowers/specs/2026-10-14-cloudflare-backend-design.md`

## Global Constraints

- `worker/` is a separate npm package (own `package.json`, `node_modules`, `tsconfig.json`, vitest 4). The root stays on vitest 2. Root vitest must exclude `worker/**`.
- `worker/.npmrc` has `legacy-peer-deps=true` (y-partyserver wants `@cloudflare/workers-types@^4`, wrangler wants `^5`). The root does **not** install y-partyserver — the client uses `y-websocket` (the protocol y-partyserver speaks).
- Party name for the room is `board-room` (partyserver kebab-cases the `BOARD_ROOM` binding). Client URL: `/parties/board-room/<boardId>`.
- Every `/api/*` route other than `/api/auth/*` requires a session (401 `{error}` otherwise). A board or asset the caller does not own is **404** (never reveal existence), except `PUT` of an asset id owned by someone else, which is 403.
- Error bodies are `{"error": string}` JSON.
- Session lifetime: 400 days, refreshed daily (`expiresIn: 34_560_000`, `updateAge: 86_400`) — matches the local backend's cookie, so anonymous users aren't silently orphaned after Better Auth's 7-day default.
- Asset size limit: 95 MB (`95 * 1024 * 1024`), enforced in the client before anything is stored, and in the Worker (413).
- Board titles: trimmed, 1–200 characters (400 otherwise).
- `VITE_BACKEND=cloud` selects the cloud backend and enables `@cloudflare/vite-plugin`; anything else is the local backend with no Cloudflare tooling loaded. `npm run dev`, `npm test`, `npm run e2e`, `npm run build` keep their current behaviour.
- Secrets: `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (empty Google values ⇒ Google sign-in disabled). Local values in `worker/.dev.vars` (gitignored).
- Match the codebase's style: no semicolons, single quotes, 2-space indent, 120-col, doc comments that explain *why*.

## Review Focus

1. **Anonymous session survives a week of inactivity** — Better Auth defaults to 7-day sessions; an anonymous user who returns after 8 days must still be the same user. Pinned by Task 2's session-lifetime test.
2. **A board opened for the first time on a new device must not render empty and then pop in** (or worse, have the user start editing an empty doc) — `whenSynced` waits for the server when the local copy has no nodes. Pinned by Task 9's "waits for the server when the cache is empty" test.
3. **Deleted board's room must not resurrect content** — a pending debounced save after `wipe()` must not write chunks back, and a client with a cached copy must be refused at the socket. Pinned by Task 6's wipe test and gate test.
4. **Large board state** — DO SQLite rows cap at 2 MB; state over that must round-trip. Pinned by Task 6's 2.5 MB round-trip test.
5. **Upload failure must not lose media** — offline/failed `PUT` keeps the file locally and retries next start. Pinned by Task 8's pending-retry tests.

---

### Task 1: Worker package scaffold, D1 schema, test harness

**Files:**
- Create: `worker/package.json`, `worker/.npmrc`, `worker/tsconfig.json`, `worker/wrangler.jsonc`, `worker/vitest.config.ts`, `worker/migrations/0001_init.sql`, `worker/src/index.ts`, `worker/src/http.ts`, `worker/src/secrets.d.ts`, `worker/test/setup.ts`, `worker/test/env.d.ts`, `worker/test/schema.test.ts`, `worker/.dev.vars.example`
- Modify: `.gitignore`, `vite.config.ts` (exclude `worker/**` from root vitest)

**Interfaces:**
- Produces: `json(data, init?)`, `fail(status, message)` in `worker/src/http.ts`; D1 tables `user`, `session`, `account`, `verification`, `boards`, `assets`; bindings `DB`, `BUCKET`, `BOARD_ROOM`.

- [ ] **Step 1: Create the package files**

`worker/package.json`:
```json
{
  "name": "brainboard-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "types": "wrangler types",
    "typecheck": "wrangler types && tsc --noEmit",
    "test": "vitest run",
    "migrate:local": "wrangler d1 migrations apply brainboard --local",
    "migrate:remote": "wrangler d1 migrations apply brainboard --remote"
  },
  "dependencies": {
    "better-auth": "1.7.7",
    "nanoid": "^5.0.9",
    "partyserver": "0.5.10",
    "y-partyserver": "2.2.0",
    "yjs": "^13.6.20"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "0.23.0",
    "typescript": "^5.7.2",
    "vitest": "^4.1.0",
    "wrangler": "4.151.0"
  }
}
```

`worker/.npmrc`:
```
# y-partyserver pins @cloudflare/workers-types@^4 as a peer; wrangler wants ^5.
# The types come from `wrangler types` anyway, so neither peer is load-bearing.
legacy-peer-deps=true
```

`worker/wrangler.jsonc`:
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "brainboard",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  // The SPA is served as static assets; only these paths reach the Worker.
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/parties/*"]
  },
  "d1_databases": [{ "binding": "DB", "database_name": "brainboard", "database_id": "local", "migrations_dir": "migrations" }],
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "brainboard" }],
  "durable_objects": { "bindings": [{ "name": "BOARD_ROOM", "class_name": "BoardRoom" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["BoardRoom"] }]
}
```
(`database_id` is replaced with the real id in Task 13 after `wrangler d1 create`.)

`worker/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["@cloudflare/vitest-pool-workers/types"]
  },
  "include": ["worker-configuration.d.ts", "src", "test"]
}
```

`worker/src/secrets.d.ts`:
```ts
// Secrets aren't in wrangler.jsonc, so `wrangler types` only sees them when a
// .dev.vars happens to exist. Declared here so CI typechecks without one.
declare namespace Cloudflare {
  interface Env {
    BETTER_AUTH_SECRET: string
    GOOGLE_CLIENT_ID: string
    GOOGLE_CLIENT_SECRET: string
  }
}
```

`worker/.dev.vars.example`:
```
BETTER_AUTH_SECRET=replace-with-output-of-openssl-rand-base64-32
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

- [ ] **Step 2: Write the schema migration**

`worker/migrations/0001_init.sql` (the Better Auth part is the exact output of `getMigrations` for better-auth 1.7.7 with the anonymous plugin):
```sql
-- Better Auth (better-auth 1.7.7 + anonymous plugin)
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "isAnonymous" integer);
create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");

-- The board registry. Contents live in each board's Durable Object.
-- owner_id deliberately has no foreign key: when an anonymous user links Google,
-- Better Auth deletes the anonymous user *after* onLinkAccount re-owns these rows.
create table boards (
  id text primary key,
  owner_id text not null,
  title text not null,
  created_at integer not null,
  opened_at integer not null,
  preview_nodes integer,
  preview_media integer,
  preview_saved_at integer
);
create index boards_owner on boards(owner_id);

-- Who may read an R2 object at assets/{id}.
create table assets (
  id text primary key,
  owner_id text not null,
  type text not null,
  size integer not null
);
create index assets_owner on assets(owner_id);
```

- [ ] **Step 3: Write the HTTP helpers and a stub entry**

`worker/src/http.ts`:
```ts
export const json = (data: unknown, init: ResponseInit = {}): Response => Response.json(data, init)

/** Every error the API returns has this one shape. */
export const fail = (status: number, message: string): Response => Response.json({ error: message }, { status })
```

`worker/src/index.ts`:
```ts
import { fail } from './http'

export default {
  async fetch(): Promise<Response> {
    return fail(404, 'Not found.')
  },
} satisfies ExportedHandler<Env>
```

- [ ] **Step 4: Test harness**

`worker/vitest.config.ts`:
```ts
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations')
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-1234',
            GOOGLE_CLIENT_ID: '',
            GOOGLE_CLIENT_SECRET: '',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/setup.ts'] },
  }
})
```

`worker/test/env.d.ts`:
```ts
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
  }
}
```

`worker/test/setup.ts`:
```ts
import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
```

- [ ] **Step 5: Write the schema test**

`worker/test/schema.test.ts`:
```ts
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('schema', () => {
  it('has the auth and app tables', async () => {
    const { results } = await env.DB.prepare("select name from sqlite_master where type = 'table'").all<{ name: string }>()
    const names = results.map((r) => r.name)
    for (const t of ['user', 'session', 'account', 'verification', 'boards', 'assets']) expect(names).toContain(t)
  })
})
```

- [ ] **Step 6: Install, generate types, run**

```bash
cd worker && npm install && npm run types && npm test
```
Expected: `schema.test.ts` 1 passed. Then `npx tsc --noEmit` → no errors.

- [ ] **Step 7: Root housekeeping**

`.gitignore` — append:
```
.wrangler/
worker/.dev.vars
```
`vite.config.ts` — in `test.exclude` add `'worker/**'`:
```ts
    exclude: ['**/node_modules/**', 'e2e/**', 'worker/**'],
```
Run `npm test` at the root → same pass count as before.

- [ ] **Step 8: Commit**

```bash
git add worker .gitignore vite.config.ts
git commit -m "Add Cloudflare worker package with D1 schema and test harness"
```

---

### Task 2: Auth — Better Auth on D1, anonymous users, ownership hand-over

**Files:**
- Create: `worker/src/auth.ts`, `worker/src/ownership.ts`, `worker/test/helpers.ts`, `worker/test/auth.test.ts`
- Modify: `worker/src/index.ts`

**Interfaces:**
- Consumes: `fail` (Task 1).
- Produces: `createAuth(env: Env, request: Request)`; `sessionUserId(env: Env, request: Request): Promise<string | null>`; `moveOwnership(db: D1Database, from: string, to: string): Promise<void>`; test helper `signIn(): Promise<{ cookie: string; userId: string }>` and `call(path, init?, cookie?)` in `worker/test/helpers.ts`.

- [ ] **Step 1: Test helpers**

`worker/test/helpers.ts`:
```ts
import { SELF } from 'cloudflare:test'

export const ORIGIN = 'http://example.com'

/** A request to the Worker as the browser would send it: same origin, with the session cookie. */
export function call(path: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Origin', ORIGIN)
  if (cookie) headers.set('Cookie', cookie)
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers })
}

/** A fresh anonymous user and the cookie that signs in as them. */
export async function signIn(): Promise<{ cookie: string; userId: string }> {
  const res = await call('/api/auth/sign-in/anonymous', { method: 'POST' })
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`)
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const body = await res.json<{ user: { id: string } }>()
  return { cookie, userId: body.user.id }
}
```

- [ ] **Step 2: Write the failing tests**

`worker/test/auth.test.ts`:
```ts
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { moveOwnership } from '../src/ownership'
import { call, signIn } from './helpers'

describe('auth', () => {
  it('mints an anonymous user and a session cookie', async () => {
    const { cookie, userId } = await signIn()
    const res = await call('/api/auth/get-session', {}, cookie)
    const body = await res.json<{ user: { id: string; isAnonymous: boolean } }>()
    expect(body.user.id).toBe(userId)
    expect(body.user.isAnonymous).toBe(true)
  })

  it('keeps a session for 400 days, not the 7-day default', async () => {
    const { userId } = await signIn()
    const row = await env.DB.prepare('select "expiresAt" as e from session where "userId" = ?').bind(userId).first<{ e: string | number }>()
    const days = (new Date(row!.e).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(399)
  })
})

describe('moveOwnership', () => {
  it("hands every board and asset from one user to another", async () => {
    await env.DB.batch([
      env.DB.prepare("insert into boards (id, owner_id, title, created_at, opened_at) values ('mo1', 'anon', 't', 1, 1)"),
      env.DB.prepare("insert into boards (id, owner_id, title, created_at, opened_at) values ('mo2', 'other', 't', 1, 1)"),
      env.DB.prepare("insert into assets (id, owner_id, type, size) values ('ma1', 'anon', 'image/png', 1)"),
    ])
    await moveOwnership(env.DB, 'anon', 'google')
    const boards = await env.DB.prepare("select id, owner_id from boards where id in ('mo1','mo2') order by id").all()
    expect(boards.results).toEqual([
      { id: 'mo1', owner_id: 'google' },
      { id: 'mo2', owner_id: 'other' },
    ])
    const asset = await env.DB.prepare("select owner_id from assets where id = 'ma1'").first()
    expect(asset).toEqual({ owner_id: 'google' })
  })
})
```

- [ ] **Step 3: Run to see them fail**

Run: `cd worker && npx vitest run test/auth.test.ts`
Expected: FAIL — `../src/ownership` not found / sign-in returns 404.

- [ ] **Step 4: Implement**

`worker/src/ownership.ts`:
```ts
/**
 * Gives everything `from` owns to `to`. Runs when an anonymous user signs in
 * with Google: Better Auth makes a new user for the Google account (or finds
 * the existing one) and then deletes the anonymous user, so the boards have to
 * move, or they would be orphaned.
 */
export async function moveOwnership(db: D1Database, from: string, to: string): Promise<void> {
  if (from === to) return
  await db.batch([
    db.prepare('update boards set owner_id = ?1 where owner_id = ?2').bind(to, from),
    db.prepare('update assets set owner_id = ?1 where owner_id = ?2').bind(to, from),
  ])
}
```

`worker/src/auth.ts`:
```ts
import { betterAuth } from 'better-auth'
import { anonymous } from 'better-auth/plugins'
import { moveOwnership } from './ownership'

/** As long as the local backend's cookie: anonymous boards are only as durable as the session. */
const SESSION_SECONDS = 400 * 24 * 60 * 60

/**
 * Built per request: the D1 binding belongs to the request's `env`, and the
 * base URL is whatever origin the request came in on (localhost in dev, the
 * workers.dev host in production) so cookies and OAuth callbacks line up.
 */
export function createAuth(env: Env, request: Request) {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {}
  return betterAuth({
    baseURL: new URL(request.url).origin,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    session: { expiresIn: SESSION_SECONDS, updateAge: 24 * 60 * 60 },
    socialProviders: google,
    plugins: [
      anonymous({
        onLinkAccount: ({ anonymousUser, newUser }) => moveOwnership(env.DB, anonymousUser.user.id, newUser.user.id),
      }),
    ],
  })
}

export async function sessionUserId(env: Env, request: Request): Promise<string | null> {
  const session = await createAuth(env, request).api.getSession({ headers: request.headers })
  return session?.user.id ?? null
}
```

`worker/src/index.ts`:
```ts
import { createAuth } from './auth'
import { fail } from './http'

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/auth/')) return createAuth(env, request).handler(request)
    return fail(404, 'Not found.')
  },
} satisfies ExportedHandler<Env>
```

- [ ] **Step 5: Run**

Run: `cd worker && npx vitest run test/auth.test.ts && npx tsc --noEmit`
Expected: 3 passed, no type errors. (If Better Auth rejects the POST with an origin error, the `Origin` header in `call` must equal the request's origin — it does: both are `http://example.com`.)

- [ ] **Step 6: Commit**

```bash
git add worker
git commit -m "Worker: Better Auth with anonymous users and ownership hand-over on link"
```

---

### Task 3: Boards API

**Files:**
- Create: `worker/src/boards.ts`, `worker/test/boards.test.ts`
- Modify: `worker/src/index.ts`

**Interfaces:**
- Consumes: `sessionUserId` (Task 2), `json`/`fail` (Task 1).
- Produces: `routeBoards(env, userId, request, url): Promise<Response | null>` handling
  - `GET /api/boards` → `BoardRecord[]` (oldest first: `created_at, id`)
  - `POST /api/boards` `{title}` → 201 `BoardRecord`
  - `PATCH /api/boards/:id` `{title}` → 204
  - `POST /api/boards/:id/opened` → 204
  - `DELETE /api/boards/:id` → 204
  - `ownsBoard(env, userId, boardId): Promise<boolean>` (exported, used by Tasks 4 and 6)
  - `BoardRecord` JSON: `{ id, ownerId, title, createdAt, openedAt }` (ms timestamps) — identical to `src/account/types.ts`.
- Leaves a hook for Task 6: `DELETE` calls `onBoardDeleted(env, id)` from `worker/src/lifecycle.ts` (created here as a function that deletes the R2 preview; Task 6 extends it to wipe the room).

- [ ] **Step 1: Write the failing tests**

`worker/test/boards.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { call, signIn } from './helpers'

type Board = { id: string; ownerId: string; title: string; createdAt: number; openedAt: number }
const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function create(cookie: string, title: string): Promise<Board> {
  const res = await call('/api/boards', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ title }) }, cookie)
  expect(res.status).toBe(201)
  return res.json()
}
const list = async (cookie: string) => (await call('/api/boards', {}, cookie)).json<Board[]>()

describe('boards API', () => {
  it('refuses requests without a session', async () => {
    const res = await call('/api/boards')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Not signed in.' })
  })

  it('creates and lists a user’s boards, oldest first', async () => {
    const { cookie, userId } = await signIn()
    const a = await create(cookie, 'First')
    const b = await create(cookie, 'Second')
    expect(a).toMatchObject({ ownerId: userId, title: 'First' })
    expect((await list(cookie)).map((x) => x.id)).toEqual([a.id, b.id])
  })

  it('trims titles and rejects empty or overlong ones', async () => {
    const { cookie } = await signIn()
    expect((await create(cookie, '  Spaced  ')).title).toBe('Spaced')
    for (const title of ['   ', 'x'.repeat(201)]) {
      const res = await call('/api/boards', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ title }) }, cookie)
      expect(res.status).toBe(400)
    }
  })

  it('renames and marks opened', async () => {
    const { cookie } = await signIn()
    const b = await create(cookie, 'Old')
    expect((await call(`/api/boards/${b.id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ title: 'New' }) }, cookie)).status).toBe(204)
    expect((await call(`/api/boards/${b.id}/opened`, { method: 'POST' }, cookie)).status).toBe(204)
    const [after] = await list(cookie)
    expect(after!.title).toBe('New')
    expect(after!.openedAt).toBeGreaterThanOrEqual(b.openedAt)
  })

  it('hides other users’ boards: 404 on every route', async () => {
    const alice = await signIn()
    const bob = await signIn()
    const b = await create(alice.cookie, 'Alice’s')
    expect(await list(bob.cookie)).toEqual([])
    const tries = [
      call(`/api/boards/${b.id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ title: 'x' }) }, bob.cookie),
      call(`/api/boards/${b.id}/opened`, { method: 'POST' }, bob.cookie),
      call(`/api/boards/${b.id}`, { method: 'DELETE' }, bob.cookie),
    ]
    for (const res of await Promise.all(tries)) expect(res.status).toBe(404)
    expect(await list(alice.cookie)).toHaveLength(1)
  })

  it('deletes', async () => {
    const { cookie } = await signIn()
    const b = await create(cookie, 'Doomed')
    expect((await call(`/api/boards/${b.id}`, { method: 'DELETE' }, cookie)).status).toBe(204)
    expect(await list(cookie)).toEqual([])
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `cd worker && npx vitest run test/boards.test.ts`
Expected: FAIL (404 everywhere).

- [ ] **Step 3: Implement**

`worker/src/lifecycle.ts`:
```ts
/** Everything that has to go when a board's row does, other than the row. */
export async function onBoardDeleted(env: Env, boardId: string): Promise<void> {
  await env.BUCKET.delete(`previews/${boardId}`)
}
```

`worker/src/boards.ts`:
```ts
import { nanoid } from 'nanoid'
import { fail, json } from './http'
import { onBoardDeleted } from './lifecycle'

type Row = { id: string; owner_id: string; title: string; created_at: number; opened_at: number }

const toRecord = (r: Row) => ({ id: r.id, ownerId: r.owner_id, title: r.title, createdAt: r.created_at, openedAt: r.opened_at })

const MAX_TITLE = 200

function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return t.length >= 1 && t.length <= MAX_TITLE ? t : null
}

async function readTitle(request: Request): Promise<string | null> {
  const body = await request.json<{ title?: unknown }>().catch(() => null)
  return cleanTitle(body?.title)
}

export async function ownsBoard(env: Env, userId: string, boardId: string): Promise<boolean> {
  const row = await env.DB.prepare('select 1 from boards where id = ?1 and owner_id = ?2').bind(boardId, userId).first()
  return row !== null
}

const NOT_FOUND = () => fail(404, 'No such board.')
const BAD_TITLE = () => fail(400, `A title is 1 to ${MAX_TITLE} characters.`)

/**
 * The board registry. Every statement is scoped to `userId`, so a board that
 * isn't the caller's behaves exactly like one that doesn't exist.
 */
export async function routeBoards(env: Env, userId: string, request: Request, url: URL): Promise<Response | null> {
  const parts = url.pathname.split('/').filter(Boolean) // ['api', 'boards', id?, action?]
  if (parts[0] !== 'api' || parts[1] !== 'boards') return null
  const [, , id, action] = parts
  const method = request.method

  if (!id) {
    if (method === 'GET') {
      const { results } = await env.DB.prepare('select * from boards where owner_id = ?1 order by created_at, id').bind(userId).all<Row>()
      return json(results.map(toRecord))
    }
    if (method === 'POST') {
      const title = await readTitle(request)
      if (!title) return BAD_TITLE()
      const t = Date.now()
      const row: Row = { id: nanoid(12), owner_id: userId, title, created_at: t, opened_at: t }
      await env.DB.prepare('insert into boards (id, owner_id, title, created_at, opened_at) values (?1, ?2, ?3, ?4, ?5)')
        .bind(row.id, row.owner_id, row.title, row.created_at, row.opened_at)
        .run()
      return json(toRecord(row), { status: 201 })
    }
    return null
  }

  if (action === undefined && method === 'PATCH') {
    const title = await readTitle(request)
    if (!title) return BAD_TITLE()
    const r = await env.DB.prepare('update boards set title = ?1 where id = ?2 and owner_id = ?3').bind(title, id, userId).run()
    return r.meta.changes ? new Response(null, { status: 204 }) : NOT_FOUND()
  }
  if (action === 'opened' && method === 'POST') {
    const r = await env.DB.prepare('update boards set opened_at = ?1 where id = ?2 and owner_id = ?3').bind(Date.now(), id, userId).run()
    return r.meta.changes ? new Response(null, { status: 204 }) : NOT_FOUND()
  }
  if (action === undefined && method === 'DELETE') {
    const r = await env.DB.prepare('delete from boards where id = ?1 and owner_id = ?2').bind(id, userId).run()
    if (!r.meta.changes) return NOT_FOUND()
    await onBoardDeleted(env, id)
    return new Response(null, { status: 204 })
  }
  return null
}
```

`worker/src/index.ts`:
```ts
import { createAuth, sessionUserId } from './auth'
import { routeBoards } from './boards'
import { fail } from './http'

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/auth/')) return createAuth(env, request).handler(request)
    if (url.pathname.startsWith('/api/')) {
      const userId = await sessionUserId(env, request)
      if (!userId) return fail(401, 'Not signed in.')
      return (await routeBoards(env, userId, request, url)) ?? fail(404, 'Not found.')
    }
    return fail(404, 'Not found.')
  },
} satisfies ExportedHandler<Env>
```

- [ ] **Step 4: Run**

Run: `cd worker && npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add worker
git commit -m "Worker: boards API scoped to the session user"
```

---

### Task 4: Previews API

**Files:**
- Create: `worker/src/previews.ts`, `worker/test/previews.test.ts`
- Modify: `worker/src/index.ts`

**Interfaces:**
- Consumes: `ownsBoard` (Task 3).
- Produces: `routePreviews(env, userId, request, url): Promise<Response | null>`:
  - `PUT /api/boards/:id/preview?nodes=N&media=M`, body = image bytes or empty → 204
  - `GET /api/boards/:id/preview` → 200, body = image bytes (empty when the board had no picture), headers `content-type`, `x-preview-nodes`, `x-preview-media`, `x-preview-saved-at`; 404 when never saved or not owned.

- [ ] **Step 1: Write the failing tests**

`worker/test/previews.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { call, signIn } from './helpers'

async function board(cookie: string): Promise<string> {
  const res = await call('/api/boards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"title":"p"}' }, cookie)
  return (await res.json<{ id: string }>()).id
}

describe('previews API', () => {
  it('is 404 before anything is saved', async () => {
    const { cookie } = await signIn()
    const id = await board(cookie)
    expect((await call(`/api/boards/${id}/preview`, {}, cookie)).status).toBe(404)
  })

  it('round-trips the picture and the counts', async () => {
    const { cookie } = await signIn()
    const id = await board(cookie)
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    const put = await call(`/api/boards/${id}/preview?nodes=4&media=2`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png }, cookie)
    expect(put.status).toBe(204)
    const res = await call(`/api/boards/${id}/preview`, {}, cookie)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('x-preview-nodes')).toBe('4')
    expect(res.headers.get('x-preview-media')).toBe('2')
    expect(Number(res.headers.get('x-preview-saved-at'))).toBeGreaterThan(0)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png)
  })

  it('stores an empty board as counts with no picture', async () => {
    const { cookie } = await signIn()
    const id = await board(cookie)
    await call(`/api/boards/${id}/preview?nodes=0&media=0`, { method: 'PUT' }, cookie)
    const res = await call(`/api/boards/${id}/preview`, {}, cookie)
    expect(res.status).toBe(200)
    expect((await res.arrayBuffer()).byteLength).toBe(0)
  })

  it('is 404 for someone else’s board', async () => {
    const alice = await signIn()
    const bob = await signIn()
    const id = await board(alice.cookie)
    expect((await call(`/api/boards/${id}/preview?nodes=1&media=0`, { method: 'PUT', body: 'x' }, bob.cookie)).status).toBe(404)
    expect((await call(`/api/boards/${id}/preview`, {}, bob.cookie)).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `cd worker && npx vitest run test/previews.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`worker/src/previews.ts`:
```ts
import { ownsBoard } from './boards'
import { fail } from './http'

const key = (boardId: string) => `previews/${boardId}`
const count = (raw: string | null) => Math.max(0, Math.floor(Number(raw) || 0))

/**
 * The home screen's picture of a board, in R2, with its counts on the board's
 * row. An empty body means "no picture" (an empty board), which is different
 * from "never saved" (404).
 */
export async function routePreviews(env: Env, userId: string, request: Request, url: URL): Promise<Response | null> {
  const m = url.pathname.match(/^\/api\/boards\/([^/]+)\/preview$/)
  if (!m) return null
  const boardId = decodeURIComponent(m[1]!)
  if (!(await ownsBoard(env, userId, boardId))) return fail(404, 'No such board.')

  if (request.method === 'PUT') {
    const bytes = await request.arrayBuffer()
    if (bytes.byteLength > 0) {
      await env.BUCKET.put(key(boardId), bytes, { httpMetadata: { contentType: request.headers.get('content-type') ?? 'image/png' } })
    } else {
      await env.BUCKET.delete(key(boardId))
    }
    await env.DB.prepare('update boards set preview_nodes = ?1, preview_media = ?2, preview_saved_at = ?3 where id = ?4')
      .bind(count(url.searchParams.get('nodes')), count(url.searchParams.get('media')), Date.now(), boardId)
      .run()
    return new Response(null, { status: 204 })
  }

  if (request.method === 'GET') {
    const row = await env.DB.prepare('select preview_nodes as n, preview_media as m, preview_saved_at as t from boards where id = ?1')
      .bind(boardId)
      .first<{ n: number | null; m: number | null; t: number | null }>()
    if (!row || row.t === null) return fail(404, 'No preview yet.')
    const obj = await env.BUCKET.get(key(boardId))
    return new Response(obj ? obj.body : null, {
      headers: {
        'content-type': obj?.httpMetadata?.contentType ?? 'application/octet-stream',
        'x-preview-nodes': String(row.n ?? 0),
        'x-preview-media': String(row.m ?? 0),
        'x-preview-saved-at': String(row.t),
        'cache-control': 'no-store',
      },
    })
  }
  return null
}
```

In `worker/src/index.ts`, route previews before boards (the boards router would otherwise treat `preview` as an unknown action and return null anyway, but order makes intent obvious):
```ts
import { routePreviews } from './previews'
// …inside the /api/ branch:
      return (
        (await routePreviews(env, userId, request, url)) ??
        (await routeBoards(env, userId, request, url)) ??
        fail(404, 'Not found.')
      )
```

- [ ] **Step 4: Run** — `cd worker && npx vitest run && npx tsc --noEmit` → all pass.

- [ ] **Step 5: Commit**

```bash
git add worker
git commit -m "Worker: board previews in R2"
```

---

### Task 5: Assets API

**Files:**
- Create: `worker/src/assets.ts`, `worker/test/assets.test.ts`
- Modify: `worker/src/index.ts`

**Interfaces:**
- Produces: `routeAssets(env, userId, request, url)`:
  - `PUT /api/assets/:id` (id `^[A-Za-z0-9_-]{1,64}$`), body bytes → 204; 403 if the id belongs to someone else; 204 no-op if already the caller's; 413 over 95 MB (by `content-length`); 400 bad id.
  - `GET /api/assets/:id` → 200 bytes with stored `content-type` and `cache-control: private, max-age=31536000, immutable`; 404 if missing or not owned.
  - `ASSET_MAX_BYTES = 95 * 1024 * 1024` exported.

- [ ] **Step 1: Write the failing tests**

`worker/test/assets.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { call, signIn } from './helpers'

const put = (id: string, body: BodyInit, cookie: string, headers: HeadersInit = { 'Content-Type': 'image/gif' }) =>
  call(`/api/assets/${id}`, { method: 'PUT', body, headers }, cookie)

describe('assets API', () => {
  it('stores and serves bytes to their owner', async () => {
    const { cookie } = await signIn()
    expect((await put('asset_ok1', new Uint8Array([1, 2, 3]), cookie)).status).toBe(204)
    const res = await call('/api/assets/asset_ok1', {}, cookie)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/gif')
    expect(res.headers.get('cache-control')).toContain('immutable')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('treats a repeat upload by the owner as done', async () => {
    const { cookie } = await signIn()
    await put('asset_rep', new Uint8Array([1]), cookie)
    expect((await put('asset_rep', new Uint8Array([9]), cookie)).status).toBe(204)
    expect(new Uint8Array(await (await call('/api/assets/asset_rep', {}, cookie)).arrayBuffer())).toEqual(new Uint8Array([1]))
  })

  it('will not let someone overwrite or read another user’s asset', async () => {
    const alice = await signIn()
    const bob = await signIn()
    await put('asset_alice', new Uint8Array([1]), alice.cookie)
    expect((await put('asset_alice', new Uint8Array([2]), bob.cookie)).status).toBe(403)
    expect((await call('/api/assets/asset_alice', {}, bob.cookie)).status).toBe(404)
  })

  it('rejects bad ids and oversize bodies', async () => {
    const { cookie } = await signIn()
    expect((await put('bad%20id', new Uint8Array([1]), cookie)).status).toBe(400)
    const big = await put('asset_big', new Uint8Array([1]), cookie, { 'Content-Type': 'video/mp4', 'Content-Length': String(96 * 1024 * 1024) })
    expect(big.status).toBe(413)
  })

  it('is 404 for an asset never uploaded', async () => {
    const { cookie } = await signIn()
    expect((await call('/api/assets/never', {}, cookie)).status).toBe(404)
  })
})
```
(If the runtime refuses a mismatched `Content-Length` header in the oversize test, replace that case with a direct unit test of `tooBig(request)` exported from `assets.ts`; keep the 413 path.)

- [ ] **Step 2: Run to see them fail** — `cd worker && npx vitest run test/assets.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`worker/src/assets.ts`:
```ts
import { fail } from './http'

export const ASSET_MAX_BYTES = 95 * 1024 * 1024
const ID = /^[A-Za-z0-9_-]{1,64}$/
const key = (id: string) => `assets/${id}`

export const tooBig = (request: Request): boolean => Number(request.headers.get('content-length') ?? 0) > ASSET_MAX_BYTES

/**
 * Media bytes, in R2. Ids are random and an asset never changes once written
 * (the client makes a new id for a new file), so a second PUT of the same id
 * is a retry, and reads can be cached forever.
 */
export async function routeAssets(env: Env, userId: string, request: Request, url: URL): Promise<Response | null> {
  const m = url.pathname.match(/^\/api\/assets\/([^/]+)$/)
  if (!m) return null
  const id = decodeURIComponent(m[1]!)
  if (!ID.test(id)) return fail(400, 'Bad asset id.')

  const owner = await env.DB.prepare('select owner_id from assets where id = ?1').bind(id).first<{ owner_id: string }>()

  if (request.method === 'PUT') {
    if (owner && owner.owner_id !== userId) return fail(403, 'That asset id is taken.')
    if (owner) return new Response(null, { status: 204 })
    if (tooBig(request)) return fail(413, 'Files are limited to 95 MB.')
    const type = request.headers.get('content-type') ?? 'application/octet-stream'
    const obj = await env.BUCKET.put(key(id), request.body, { httpMetadata: { contentType: type } })
    await env.DB.prepare('insert into assets (id, owner_id, type, size) values (?1, ?2, ?3, ?4)')
      .bind(id, userId, type, obj?.size ?? 0)
      .run()
    return new Response(null, { status: 204 })
  }

  if (request.method === 'GET') {
    if (!owner || owner.owner_id !== userId) return fail(404, 'No such asset.')
    const obj = await env.BUCKET.get(key(id))
    if (!obj) return fail(404, 'No such asset.')
    return new Response(obj.body, {
      headers: {
        'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
        'cache-control': 'private, max-age=31536000, immutable',
      },
    })
  }
  return null
}
```

`worker/src/index.ts` — add `(await routeAssets(env, userId, request, url)) ??` as the first entry of the `/api/` chain, importing from `./assets`.

- [ ] **Step 4: Run** — `cd worker && npx vitest run && npx tsc --noEmit` → all pass.

- [ ] **Step 5: Commit**

```bash
git add worker
git commit -m "Worker: owner-scoped media assets in R2"
```

---

### Task 6: BoardRoom Durable Object and the socket gate

**Files:**
- Create: `worker/src/room.ts`, `worker/test/room.test.ts`
- Modify: `worker/src/index.ts`, `worker/src/lifecycle.ts`

**Interfaces:**
- Consumes: `ownsBoard` (Task 3), `sessionUserId` (Task 2).
- Produces: `class BoardRoom extends YServer` (exported from `index.ts`) with RPC `wipe(): Promise<void>`; `readState(sql: SqlStorage): Uint8Array | null`, `writeState(storage: DurableObjectStorage, state: Uint8Array): void`; WebSocket endpoint `/parties/board-room/:boardId` (401 no session, 404 not owner, non-WebSocket requests 400).

- [ ] **Step 1: Write the failing tests**

`worker/test/room.test.ts`:
```ts
import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { readState, writeState, type BoardRoom } from '../src/room'
import { call, signIn } from './helpers'

const upgrade = (boardId: string, cookie?: string) =>
  call(`/parties/board-room/${boardId}`, { headers: { Upgrade: 'websocket' } }, cookie)

async function board(cookie: string): Promise<string> {
  const res = await call('/api/boards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"title":"r"}' }, cookie)
  return (await res.json<{ id: string }>()).id
}

describe('room storage', () => {
  it('round-trips state larger than one SQLite row (2 MB)', async () => {
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName('chunks'))
    await runInDurableObject(stub, (_room: BoardRoom, state) => {
      const big = new Uint8Array(2_500_000).map((_, i) => i % 251)
      writeState(state.storage, big)
      expect(readState(state.storage.sql)).toEqual(big)
      writeState(state.storage, new Uint8Array([7]))
      expect(readState(state.storage.sql)).toEqual(new Uint8Array([7]))
    })
  })

  it('reads nothing from a fresh room', async () => {
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName('fresh'))
    await runInDurableObject(stub, (_room: BoardRoom, state) => {
      expect(readState(state.storage.sql)).toBeNull()
    })
  })

  it('stays empty after wipe, even if a debounced save fires late', async () => {
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName('wiped'))
    await runInDurableObject(stub, async (room: BoardRoom, state) => {
      writeState(state.storage, new Uint8Array([1, 2, 3]))
      await room.wipe()
      await room.onSave()
      expect(readState(state.storage.sql)).toBeNull()
    })
  })
})

describe('room gate', () => {
  it('401 without a session', async () => {
    expect((await upgrade('anything')).status).toBe(401)
  })

  it('404 for a board the user does not own', async () => {
    const alice = await signIn()
    const bob = await signIn()
    const id = await board(alice.cookie)
    expect((await upgrade(id, bob.cookie)).status).toBe(404)
  })

  it('404 once the board is deleted', async () => {
    const { cookie } = await signIn()
    const id = await board(cookie)
    await call(`/api/boards/${id}`, { method: 'DELETE' }, cookie)
    expect((await upgrade(id, cookie)).status).toBe(404)
  })

  it('upgrades for the owner', async () => {
    const { cookie } = await signIn()
    const id = await board(cookie)
    const res = await upgrade(id, cookie)
    expect(res.status).toBe(101)
    res.webSocket!.accept()
    res.webSocket!.close()
  })
})
```

- [ ] **Step 2: Run to see them fail** — `cd worker && npx vitest run test/room.test.ts` → FAIL (`../src/room` missing).

- [ ] **Step 3: Implement the room**

`worker/src/room.ts`:
```ts
import { YServer } from 'y-partyserver'
import * as Y from 'yjs'

/** Under the 2 MB row limit of a Durable Object's SQLite, with room to spare. */
const CHUNK_BYTES = 1_000_000

function ensureTable(sql: SqlStorage): void {
  sql.exec('create table if not exists doc_chunks (seq integer primary key, data blob not null)')
}

/** The board's merged Yjs state, or null for a room that has never saved. */
export function readState(sql: SqlStorage): Uint8Array | null {
  ensureTable(sql)
  const rows = sql.exec<{ data: ArrayBuffer }>('select data from doc_chunks order by seq').toArray()
  if (rows.length === 0) return null
  const out = new Uint8Array(rows.reduce((n, r) => n + r.data.byteLength, 0))
  let at = 0
  for (const r of rows) {
    out.set(new Uint8Array(r.data), at)
    at += r.data.byteLength
  }
  return out
}

/**
 * Replaces the stored state. The whole merged document is written each time,
 * not appended updates, so storage tracks the board's size rather than its
 * history.
 */
export function writeState(storage: DurableObjectStorage, state: Uint8Array): void {
  storage.transactionSync(() => {
    ensureTable(storage.sql)
    storage.sql.exec('delete from doc_chunks')
    for (let at = 0, seq = 0; at < state.length; at += CHUNK_BYTES, seq++) {
      storage.sql.exec('insert into doc_chunks (seq, data) values (?, ?)', seq, state.slice(at, at + CHUNK_BYTES).buffer)
    }
  })
}

/**
 * One board's live document. Today exactly one user ever connects (the
 * owner), from one or more tabs or devices; live collaboration is this same
 * room with a wider gate.
 */
export class BoardRoom extends YServer {
  static options = { hibernate: true }
  static callbackOptions = { debounceWait: 2000, debounceMaxWait: 10000, timeout: 5000 }

  #wiped = false

  async onLoad(): Promise<void> {
    const state = readState(this.ctx.storage.sql)
    if (state) Y.applyUpdate(this.document, state)
  }

  async onSave(): Promise<void> {
    if (this.#wiped) return
    writeState(this.ctx.storage, Y.encodeStateAsUpdate(this.document))
  }

  /** The board was deleted: drop every connection and everything stored. */
  async wipe(): Promise<void> {
    this.#wiped = true
    for (const conn of this.getConnections()) conn.close(4404, 'Board deleted')
    await this.ctx.storage.deleteAll()
  }
}
```

- [ ] **Step 4: Gate and routing**

`worker/src/lifecycle.ts`:
```ts
import { getServerByName } from 'partyserver'

/** Everything that has to go when a board's row does, other than the row. */
export async function onBoardDeleted(env: Env, boardId: string): Promise<void> {
  const room = await getServerByName(env.BOARD_ROOM, boardId)
  await Promise.all([env.BUCKET.delete(`previews/${boardId}`), room.wipe()])
}
```

`worker/src/index.ts` (final shape):
```ts
import { routePartykitRequest } from 'partyserver'
import { routeAssets } from './assets'
import { createAuth, sessionUserId } from './auth'
import { ownsBoard, routeBoards } from './boards'
import { fail } from './http'
import { routePreviews } from './previews'

export { BoardRoom } from './room'

/**
 * Only the board's owner gets a socket. A deleted board fails here too, so a
 * device still holding a cached copy can't push it back into a wiped room.
 */
async function gateRoom(env: Env, request: Request, boardId: string): Promise<Response | void> {
  const userId = await sessionUserId(env, request)
  if (!userId) return fail(401, 'Not signed in.')
  if (!(await ownsBoard(env, userId, boardId))) return fail(404, 'No such board.')
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/auth/')) return createAuth(env, request).handler(request)
    if (url.pathname.startsWith('/parties/')) {
      const res = await routePartykitRequest(request, env, {
        onBeforeConnect: (req, lobby) => gateRoom(env, req, lobby.name),
        onBeforeRequest: () => fail(400, 'Rooms are WebSocket only.'),
      })
      return res ?? fail(404, 'Not found.')
    }
    if (url.pathname.startsWith('/api/')) {
      const userId = await sessionUserId(env, request)
      if (!userId) return fail(401, 'Not signed in.')
      return (
        (await routeAssets(env, userId, request, url)) ??
        (await routePreviews(env, userId, request, url)) ??
        (await routeBoards(env, userId, request, url)) ??
        fail(404, 'Not found.')
      )
    }
    return fail(404, 'Not found.')
  },
} satisfies ExportedHandler<Env>
```

- [ ] **Step 5: Regenerate types and run everything**

Run: `cd worker && npm run types && npx vitest run && npx tsc --noEmit`
Expected: all pass. (`wrangler types` now types `env.BOARD_ROOM` as `DurableObjectNamespace<BoardRoom>`, which is what makes `room.wipe()` typecheck.)

- [ ] **Step 6: Commit**

```bash
git add worker
git commit -m "Worker: BoardRoom durable object with owner-only socket gate"
```

---

### Task 7: Client — account types, API helper, cloud auth, cloud boards

**Files:**
- Create: `src/vite-env.d.ts`, `src/account/cloud/api.ts`, `src/account/cloud/cloudAuth.ts`, `src/account/cloud/cloudAuth.test.ts`, `src/account/cloud/cloudBoards.ts`, `src/account/cloud/cloudBoards.test.ts`
- Modify: `src/account/types.ts`, `package.json` (add `better-auth@1.7.7`, `y-websocket@^3.0.0`)

**Interfaces:**
- Produces:
  - `types.ts`: `User = { id; kind: 'anonymous' | 'google'; createdAt: number; email?: string; name?: string }`; `AuthProvider.signInWithGoogle?: () => Promise<void>`.
  - `api(path: string, init?: RequestInit): Promise<Response>` throwing `ApiError { status: number }`.
  - `createCloudAuth(client?: AuthClient): AuthProvider` (with `signInWithGoogle`).
  - `createCloudBoards(): BoardRepository`.

- [ ] **Step 1: Install client deps and type env vars**

```bash
npm install better-auth@1.7.7 y-websocket@^3.0.0
```
`src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `cloud` for the Cloudflare backend; anything else is the in-browser one. */
  readonly VITE_BACKEND?: string
}
```

- [ ] **Step 2: Widen the account types**

In `src/account/types.ts` replace the `User` block and `AuthProvider`:
```ts
/**
 * Whoever is using the app. Every visit starts as an anonymous user; signing in
 * with Google (cloud backend only) makes a *different* user — Better Auth does
 * not keep the anonymous id — and the server moves the anonymous user's boards
 * to it in the same step, so nothing is lost but the id changes.
 */
export type User = {
  id: UserId
  kind: 'anonymous' | 'google'
  createdAt: number
  email?: string
  name?: string
}

export type Session = { user: User }

export interface AuthProvider {
  /** The current session, minting an anonymous user if there is none yet. */
  start(): Promise<Session>
  /** Leaves the page for Google's sign-in, coming back signed in. Absent where unsupported. */
  signInWithGoogle?: () => Promise<void>
}
```
Run `npm run typecheck` → passes (local auth still only produces `'anonymous'`).

- [ ] **Step 3: API helper**

`src/account/cloud/api.ts`:
```ts
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** A same-origin call to the Worker. Non-2xx becomes an ApiError carrying the server's message. */
export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, { credentials: 'same-origin', ...init })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status}).`)
  }
  return res
}

export const JSON_HEADERS = { 'Content-Type': 'application/json' }
```

- [ ] **Step 4: Failing tests for cloud auth**

`src/account/cloud/cloudAuth.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { createCloudAuth, type AuthClient } from './cloudAuth'

const anonUser = { id: 'u1', createdAt: '2026-10-01T00:00:00.000Z', isAnonymous: true, email: 'x@anonymous.invalid', name: 'Anonymous' }

function client(session: unknown, signedIn: unknown = { data: { user: anonUser }, error: null }): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue({ data: session, error: null }),
    signIn: { anonymous: vi.fn().mockResolvedValue(signedIn), social: vi.fn().mockResolvedValue({}) },
  }
}

describe('createCloudAuth', () => {
  it('returns the existing session’s user', async () => {
    const c = client({ user: { ...anonUser, id: 'g1', isAnonymous: false, email: 'a@b.c', name: 'Ada' } })
    const { user } = await createCloudAuth(c).start()
    expect(user).toEqual({ id: 'g1', kind: 'google', createdAt: Date.parse(anonUser.createdAt), email: 'a@b.c', name: 'Ada' })
    expect(c.signIn.anonymous).not.toHaveBeenCalled()
  })

  it('signs in anonymously when there is no session, hiding the placeholder email', async () => {
    const c = client(null)
    const { user } = await createCloudAuth(c).start()
    expect(user).toEqual({ id: 'u1', kind: 'anonymous', createdAt: Date.parse(anonUser.createdAt) })
  })

  it('surfaces a failed anonymous sign-in', async () => {
    const c = client(null, { data: null, error: { message: 'nope' } })
    await expect(createCloudAuth(c).start()).rejects.toThrow('nope')
  })

  it('sends Google sign-in back to the app', async () => {
    const c = client(null)
    await createCloudAuth(c).signInWithGoogle!()
    expect(c.signIn.social).toHaveBeenCalledWith({ provider: 'google', callbackURL: `${location.origin}/` })
  })
})
```

Run: `npx vitest run src/account/cloud/cloudAuth.test.ts` → FAIL (module missing).

- [ ] **Step 5: Implement cloud auth**

`src/account/cloud/cloudAuth.ts`:
```ts
import { createAuthClient } from 'better-auth/client'
import { anonymousClient } from 'better-auth/client/plugins'
import type { AuthProvider, Session, User } from '../types'

type AuthUser = { id: string; createdAt: string | Date; isAnonymous?: boolean | null; email?: string; name?: string }
type Result<T> = { data: T | null; error: { message?: string } | null }

/** The slice of Better Auth's client this app uses — narrow so tests can stand it in. */
export type AuthClient = {
  getSession(): Promise<Result<{ user: AuthUser }>>
  signIn: {
    anonymous(): Promise<Result<{ user: AuthUser }>>
    social(opts: { provider: 'google'; callbackURL: string }): Promise<unknown>
  }
}

const defaultClient = (): AuthClient =>
  createAuthClient({ plugins: [anonymousClient()] }) as unknown as AuthClient

function toUser(u: AuthUser): User {
  const createdAt = new Date(u.createdAt).getTime()
  // An anonymous user's email is a generated placeholder; never show it.
  if (u.isAnonymous) return { id: u.id, kind: 'anonymous', createdAt }
  return { id: u.id, kind: 'google', createdAt, email: u.email, name: u.name }
}

export function createCloudAuth(client: AuthClient = defaultClient()): AuthProvider {
  return {
    async start(): Promise<Session> {
      const existing = await client.getSession()
      if (existing.data?.user) return { user: toUser(existing.data.user) }
      const made = await client.signIn.anonymous()
      if (!made.data) throw new Error(made.error?.message ?? 'Could not start a session.')
      return { user: toUser(made.data.user) }
    },
    async signInWithGoogle() {
      await client.signIn.social({ provider: 'google', callbackURL: `${location.origin}/` })
    },
  }
}
```

Run the test → 4 passed.

- [ ] **Step 6: Failing tests for cloud boards**

`src/account/cloud/cloudBoards.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCloudBoards } from './cloudBoards'

const fetchMock = vi.fn<typeof fetch>()
vi.stubGlobal('fetch', fetchMock)
afterEach(() => fetchMock.mockReset())

const ok = (body: unknown, init: ResponseInit = {}) =>
  new Response(body === null ? null : typeof body === 'string' || body instanceof Blob ? body : JSON.stringify(body), { status: 200, ...init })

describe('createCloudBoards', () => {
  const boards = createCloudBoards()

  it('lists', async () => {
    fetchMock.mockResolvedValue(ok([{ id: 'b1' }]))
    expect(await boards.list('u')).toEqual([{ id: 'b1' }])
    expect(fetchMock).toHaveBeenCalledWith('/api/boards', expect.objectContaining({ credentials: 'same-origin' }))
  })

  it('creates with a JSON title', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'b2', title: 'T' }, { status: 201 }))
    await boards.create('u', 'T')
    const [path, init] = fetchMock.mock.calls[0]!
    expect(path).toBe('/api/boards')
    expect(init).toMatchObject({ method: 'POST', body: '{"title":"T"}' })
  })

  it('renames, marks opened, removes', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await boards.rename('u', 'b 1', 'New')
    await boards.markOpened('u', 'b 1')
    await boards.remove('u', 'b 1')
    expect(fetchMock.mock.calls.map(([p, i]) => `${i?.method} ${p}`)).toEqual([
      'PATCH /api/boards/b%201',
      'POST /api/boards/b%201/opened',
      'DELETE /api/boards/b%201',
    ])
  })

  it('throws the server’s message', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"No such board."}', { status: 404 }))
    await expect(boards.rename('u', 'x', 'y')).rejects.toThrow('No such board.')
  })

  it('saves a preview as bytes plus counts', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const image = new Blob([new Uint8Array([1])], { type: 'image/png' })
    await boards.savePreview('u', 'b1', { image, nodes: 3, media: 1 })
    const [path, init] = fetchMock.mock.calls[0]!
    expect(path).toBe('/api/boards/b1/preview?nodes=3&media=1')
    expect(init).toMatchObject({ method: 'PUT', body: image, headers: { 'Content-Type': 'image/png' } })
  })

  it('reads a preview, with an empty body meaning no picture', async () => {
    const headers = { 'x-preview-nodes': '0', 'x-preview-media': '0', 'x-preview-saved-at': '42' }
    fetchMock.mockResolvedValue(ok(null, { headers }))
    expect(await boards.getPreview('u', 'b1')).toEqual({ image: null, nodes: 0, media: 0, savedAt: 42 })
  })

  it('reads a missing preview as null', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"No preview yet."}', { status: 404 }))
    expect(await boards.getPreview('u', 'b1')).toBeNull()
  })
})
```

Run → FAIL.

- [ ] **Step 7: Implement cloud boards**

`src/account/cloud/cloudBoards.ts`:
```ts
import type { BoardRepository } from '../types'
import { ApiError, JSON_HEADERS, api } from './api'

const path = (id: string, rest = '') => `/api/boards/${encodeURIComponent(id)}${rest}`

/**
 * The board registry over HTTP. The `userId` arguments are part of the shared
 * interface but are not sent: the Worker only trusts the session cookie.
 */
export function createCloudBoards(): BoardRepository {
  return {
    async list() {
      return (await api('/api/boards')).json()
    },
    async create(_userId, title) {
      return (await api('/api/boards', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ title }) })).json()
    },
    async rename(_userId, id, title) {
      await api(path(id), { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ title }) })
    },
    async markOpened(_userId, id) {
      await api(path(id, '/opened'), { method: 'POST' })
    },
    async remove(_userId, id) {
      await api(path(id), { method: 'DELETE' })
    },
    async savePreview(_userId, id, { image, nodes, media }) {
      await api(path(id, `/preview?nodes=${nodes}&media=${media}`), {
        method: 'PUT',
        headers: image ? { 'Content-Type': image.type } : undefined,
        body: image ?? undefined,
      })
    },
    async getPreview(_userId, id) {
      let res: Response
      try {
        res = await api(path(id, '/preview'))
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
      const blob = await res.blob()
      return {
        image: blob.size > 0 ? blob : null,
        nodes: Number(res.headers.get('x-preview-nodes') ?? 0),
        media: Number(res.headers.get('x-preview-media') ?? 0),
        savedAt: Number(res.headers.get('x-preview-saved-at') ?? 0),
      }
    },
  }
}
```

- [ ] **Step 8: Run** — `npx vitest run src/account/cloud && npm run typecheck && npm run lint` → all pass.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/vite-env.d.ts src/account
git commit -m "Client: cloud auth and board registry over the Worker API"
```

---

### Task 8: Client — cloud assets with local cache and retry

**Files:**
- Create: `src/account/cloud/cloudAssets.ts`, `src/account/cloud/cloudAssets.test.ts`

**Interfaces:**
- Consumes: `api`, `ApiError` (Task 7); `AssetBackend`, `indexedDbAssets` (`src/document/assets.ts`).
- Produces: `ASSET_MAX_BYTES`; `createCloudAssets(cache?: AssetBackend, storage?: Storage): CloudAssets` where `CloudAssets = AssetBackend & { retryPending(): Promise<void> }`.

- [ ] **Step 1: Failing tests**

`src/account/cloud/cloudAssets.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssetBackend } from '../../document/assets'
import { ASSET_MAX_BYTES, createCloudAssets } from './cloudAssets'

const fetchMock = vi.fn<typeof fetch>()
vi.stubGlobal('fetch', fetchMock)
afterEach(() => {
  fetchMock.mockReset()
  localStorage.clear()
})

function memoryCache(): AssetBackend & { map: Map<string, Blob> } {
  const map = new Map<string, Blob>()
  return { map, put: async (id, b) => void map.set(id, b), get: async (id) => map.get(id) ?? null }
}
const blob = (n = 3) => new Blob([new Uint8Array(n)], { type: 'image/png' })

describe('createCloudAssets', () => {
  it('writes locally and uploads', async () => {
    const cache = memoryCache()
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await createCloudAssets(cache, localStorage).put('a1', blob())
    expect(cache.map.has('a1')).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/a1', expect.objectContaining({ method: 'PUT' }))
  })

  it('refuses a file over the limit before storing anything', async () => {
    const cache = memoryCache()
    const huge = { size: ASSET_MAX_BYTES + 1, type: 'video/mp4' } as Blob
    await expect(createCloudAssets(cache, localStorage).put('big', huge)).rejects.toThrow('95 MB')
    expect(cache.map.size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps a failed upload locally and retries it later', async () => {
    const cache = memoryCache()
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    const assets = createCloudAssets(cache, localStorage)
    await assets.put('a2', blob())
    expect(cache.map.has('a2')).toBe(true)

    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await createCloudAssets(cache, localStorage).retryPending()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/assets/a2', expect.objectContaining({ method: 'PUT' }))
    fetchMock.mockClear()
    await createCloudAssets(cache, localStorage).retryPending()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads from the cache first, then the server, caching what it fetched', async () => {
    const cache = memoryCache()
    cache.map.set('local', blob(1))
    const assets = createCloudAssets(cache, localStorage)
    expect(await assets.get('local')).toBe(cache.map.get('local'))
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValue(new Response(blob(2)))
    const fetched = await assets.get('remote')
    expect(fetched?.size).toBe(2)
    expect(cache.map.has('remote')).toBe(true)
  })

  it('reads a missing asset as null', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"No such asset."}', { status: 404 }))
    expect(await createCloudAssets(memoryCache(), localStorage).get('gone')).toBeNull()
  })
})
```
Run → FAIL.

- [ ] **Step 2: Implement**

`src/account/cloud/cloudAssets.ts`:
```ts
import { indexedDbAssets, type AssetBackend } from '../../document/assets'
import type { AssetId } from '../../types'
import { ApiError, api } from './api'

/** The Worker's ceiling (100 MB request bodies on the free plan), with headroom. */
export const ASSET_MAX_BYTES = 95 * 1024 * 1024
const PENDING_KEY = 'bb_pending_uploads'

export type CloudAssets = AssetBackend & {
  /** Uploads anything a previous put could not. Stops at the first failure; the rest wait for next time. */
  retryPending(): Promise<void>
}

/**
 * Media in R2, with this browser's IndexedDB store in front of it: writes land
 * locally first (so the node shows at once, and offline), reads come from the
 * local copy when there is one. A failed upload is remembered and retried on
 * the next start, so a file is never only on a server that never got it.
 */
export function createCloudAssets(cache: AssetBackend = indexedDbAssets, storage: Storage = localStorage): CloudAssets {
  const pending = (): Set<AssetId> => {
    try {
      return new Set(JSON.parse(storage.getItem(PENDING_KEY) ?? '[]') as AssetId[])
    } catch {
      return new Set()
    }
  }
  const setPending = (ids: Set<AssetId>) => storage.setItem(PENDING_KEY, JSON.stringify([...ids]))
  const mark = (id: AssetId, waiting: boolean) => {
    const ids = pending()
    if (waiting) ids.add(id)
    else ids.delete(id)
    setPending(ids)
  }

  const upload = (id: AssetId, blob: Blob) =>
    api(`/api/assets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    })

  return {
    async put(id, blob) {
      if (blob.size > ASSET_MAX_BYTES) throw new Error('That file is too large to upload — the limit is 95 MB.')
      await cache.put(id, blob)
      try {
        await upload(id, blob)
      } catch {
        mark(id, true)
      }
    },

    async get(id) {
      const local = await cache.get(id)
      if (local) return local
      let res: Response
      try {
        res = await api(`/api/assets/${encodeURIComponent(id)}`)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
      const blob = await res.blob()
      await cache.put(id, blob).catch(() => {})
      return blob
    },

    async retryPending() {
      for (const id of pending()) {
        const blob = await cache.get(id)
        if (!blob) {
          mark(id, false)
          continue
        }
        try {
          await upload(id, blob)
          mark(id, false)
        } catch {
          return
        }
      }
    },
  }
}
```

- [ ] **Step 3: Run** — `npx vitest run src/account/cloud/cloudAssets.test.ts && npm run typecheck` → pass.

- [ ] **Step 4: Commit**

```bash
git add src/account/cloud
git commit -m "Client: cloud media with local cache and upload retry"
```

---

### Task 9: Client — cloud persistence (IndexedDB + room socket) and the offline indicator

**Files:**
- Create: `src/account/cloud/cloudPersistence.ts`, `src/account/cloud/cloudPersistence.test.ts`
- Modify: `src/document/persistence.ts` (extend `Persistence`), `src/useBoard.ts` (expose `status`), `src/App.tsx` (offline note)

**Interfaces:**
- Produces:
  - `persistence.ts`: `type SyncStatus = 'connecting' | 'online' | 'offline'`; `Persistence` gains optional `status?: { get(): SyncStatus; subscribe(cb: (s: SyncStatus) => void): () => void }` and `whenServerSynced?: Promise<void>`.
  - `createCloudPersistence(makeRemote?: RemoteFactory, emptyWaitMs?: number): (doc, boardId) => Persistence`
  - `RemoteFactory = (boardId: string, doc: Y.Doc) => Remote`, `Remote = { on(event: 'status', cb: (e: { status: string }) => void): void; on(event: 'sync', cb: (synced: boolean) => void): void; destroy(): void }`
  - `ROOM_PATH = '/parties/board-room'`
  - `useBoard` returns `status: SyncStatus | null` (null for backends without one).

- [ ] **Step 1: Extend the Persistence type**

`src/document/persistence.ts` — replace the `Persistence` type:
```ts
export type SyncStatus = 'connecting' | 'online' | 'offline'

export type Persistence = {
  /** Resolves once the board can be shown: the on-disk state is merged into the document. */
  whenSynced: Promise<void>
  destroy: () => Promise<void>
  /** Whether a server copy is being kept in step. Absent for in-browser-only persistence. */
  status?: { get(): SyncStatus; subscribe(cb: (s: SyncStatus) => void): () => void }
  /** Resolves once the server has everything this document has. Absent for in-browser-only persistence. */
  whenServerSynced?: Promise<void>
}
```

- [ ] **Step 2: Failing tests**

`src/account/cloud/cloudPersistence.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import { boardKey } from '../../document/persistence'
import { nodesMap } from '../../document/schema'
import { createCloudPersistence, type Remote } from './cloudPersistence'

type Listener = (arg: never) => void
function fakeRemote() {
  const listeners: Record<string, Listener[]> = {}
  const remote: Remote & { emit(event: string, arg: unknown): void; destroyed: boolean } = {
    destroyed: false,
    on(event: string, cb: Listener) {
      ;(listeners[event] ??= []).push(cb)
    },
    emit(event, arg) {
      for (const cb of listeners[event] ?? []) (cb as (a: unknown) => void)(arg)
    },
    destroy() {
      this.destroyed = true
    },
  } as never
  return remote
}

const uniqueId = () => `t-${Math.random().toString(36).slice(2)}`

async function seedLocal(boardId: string) {
  const doc = new Y.Doc()
  const p = new IndexeddbPersistence(boardKey(boardId), doc)
  await p.whenSynced
  nodesMap(doc).set('n1', new Y.Map())
  await new Promise((r) => setTimeout(r, 50))
  await p.destroy()
}

describe('createCloudPersistence', () => {
  it('opens from the local copy without waiting for the server', async () => {
    const id = uniqueId()
    await seedLocal(id)
    const remote = fakeRemote()
    const doc = new Y.Doc()
    const p = createCloudPersistence(() => remote, 10_000)(doc, id)
    await p.whenSynced
    expect(nodesMap(doc).has('n1')).toBe(true)
    await p.destroy()
    expect(remote.destroyed).toBe(true)
  })

  it('waits for the server when the cache is empty (first open on this device)', async () => {
    const remote = fakeRemote()
    const p = createCloudPersistence(() => remote, 10_000)(new Y.Doc(), uniqueId())
    let done = false
    void p.whenSynced.then(() => (done = true))
    await new Promise((r) => setTimeout(r, 50))
    expect(done).toBe(false)
    remote.emit('sync', true)
    await p.whenSynced
    await p.destroy()
  })

  it('gives up waiting on the server after a while, so an empty board opens offline', async () => {
    const p = createCloudPersistence(() => fakeRemote(), 30)(new Y.Doc(), uniqueId())
    await p.whenSynced
    await p.destroy()
  })

  it('reports connection status', async () => {
    const remote = fakeRemote()
    const p = createCloudPersistence(() => remote, 10)(new Y.Doc(), uniqueId())
    const seen: string[] = []
    p.status!.subscribe((s) => seen.push(s))
    expect(p.status!.get()).toBe('connecting')
    remote.emit('status', { status: 'connected' })
    remote.emit('status', { status: 'disconnected' })
    expect(seen).toEqual(['online', 'offline'])
    await p.destroy()
  })

  it('resolves whenServerSynced on the first sync', async () => {
    const remote = fakeRemote()
    const p = createCloudPersistence(() => remote, 10)(new Y.Doc(), uniqueId())
    remote.emit('sync', true)
    await p.whenServerSynced
    await p.destroy()
  })
})
```
Run → FAIL.

- [ ] **Step 3: Implement**

`src/account/cloud/cloudPersistence.ts`:
```ts
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import type * as Y from 'yjs'
import { boardKey, type Persistence, type SyncStatus } from '../../document/persistence'
import { edgesMap, nodesMap } from '../../document/schema'

/** partyserver's route for the BOARD_ROOM binding (kebab-cased) — see worker/src/index.ts. */
export const ROOM_PATH = '/parties/board-room'

export type Remote = {
  on(event: 'status', cb: (e: { status: string }) => void): void
  on(event: 'sync', cb: (synced: boolean) => void): void
  destroy(): void
}
export type RemoteFactory = (boardId: string, doc: Y.Doc) => Remote

/**
 * y-partyserver speaks y-websocket's protocol, so its plain client is enough —
 * and keeps y-partyserver (and its Cloudflare type peers) out of the app.
 */
const socketRemote: RemoteFactory = (boardId, doc) => {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return new WebsocketProvider(`${proto}//${location.host}${ROOM_PATH}`, boardId, doc)
}

/** How long a board with nothing in the local copy waits for the server before opening anyway. */
const EMPTY_WAIT_MS = 4000

/**
 * A board kept in this browser's IndexedDB *and* in its room on the server.
 * The local copy is what the board opens from, so a board seen before on this
 * device opens instantly and works offline; Yjs merges the two both ways when
 * the socket connects.
 *
 * A board never opened here has an empty local copy. Showing that would flash
 * an empty canvas (and let the user start drawing on it) before the real
 * contents arrive, so it waits for the server — but only so long, or a
 * genuinely empty board could not be opened offline.
 */
export function createCloudPersistence(makeRemote: RemoteFactory = socketRemote, emptyWaitMs = EMPTY_WAIT_MS) {
  return (doc: Y.Doc, boardId: string): Persistence => {
    const local = new IndexeddbPersistence(boardKey(boardId), doc)
    const remote = makeRemote(boardId, doc)

    let status: SyncStatus = 'connecting'
    const listeners = new Set<(s: SyncStatus) => void>()
    remote.on('status', ({ status: s }) => {
      status = s === 'connected' ? 'online' : s === 'connecting' ? 'connecting' : 'offline'
      for (const l of listeners) l(status)
    })

    const whenServerSynced = new Promise<void>((resolve) => {
      remote.on('sync', (synced) => synced && resolve())
    })

    const whenSynced = local.whenSynced.then(async () => {
      if (nodesMap(doc).size > 0 || edgesMap(doc).size > 0) return
      await Promise.race([whenServerSynced, new Promise((r) => setTimeout(r, emptyWaitMs))])
    })

    return {
      whenSynced,
      whenServerSynced,
      status: {
        get: () => status,
        subscribe(cb) {
          listeners.add(cb)
          return () => listeners.delete(cb)
        },
      },
      async destroy() {
        remote.destroy()
        await local.destroy()
      },
    }
  }
}
```

- [ ] **Step 4: Run** — `npx vitest run src/account/cloud/cloudPersistence.test.ts` → 5 passed.

- [ ] **Step 5: Expose status from useBoard**

In `src/useBoard.ts`:
- Import `type SyncStatus` from `./document/persistence`.
- Add `status: SyncStatus | null` to `Board`.
- Add `const [status, setStatus] = useState<SyncStatus | null>(null)`.
- Inside the effect, after `p = persist(doc, boardId)` succeeds (after the try/catch), add:
```ts
    setStatus(p?.status?.get() ?? null)
    const unsubscribe = p?.status?.subscribe((s) => alive && setStatus(s))
```
- In the cleanup, call `unsubscribe?.()` before `void p?.destroy()`.
- Return `{ doc, store, undo, ready, error, status }`.

Run `npx vitest run src` — existing `useBoard`/`App` tests still pass.

- [ ] **Step 6: Offline note in App**

In `src/App.tsx`, take `status` from `useBoard(boardId, persist)` and render, next to where `notice` is rendered (same container), when `status === 'offline'`:
```tsx
      {status === 'offline' && (
        <div
          data-testid="sync-offline"
          role="status"
          style={{
            position: 'fixed',
            left: 16,
            bottom: 16,
            padding: '6px 10px',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.72)',
            color: '#fff',
            font: '500 12px system-ui, sans-serif',
            pointerEvents: 'none',
          }}
        >
          Offline — changes are kept on this device and will sync when you reconnect.
        </div>
      )}
```
Before writing it, look at how `notice` is styled in `App.tsx` and reuse its colours/font helpers instead of the literals above if there are any; keep the testid and text.

Add to `src/App.test.tsx` (or the nearest existing App test file):
```tsx
it('says when the board is offline', async () => {
  const persist = () => ({
    whenSynced: Promise.resolve(),
    destroy: async () => {},
    status: { get: () => 'offline' as const, subscribe: () => () => {} },
  })
  render(<App boardId="offline-test" persist={persist} />)
  expect(await screen.findByTestId('sync-offline')).toBeTruthy()
})
```
(Match the file's existing imports/render helpers.) Run → pass.

- [ ] **Step 7: Run all** — `npm test && npm run typecheck && npm run lint` → pass.

- [ ] **Step 8: Commit**

```bash
git add src
git commit -m "Client: boards persist to their room on the server, cached in IndexedDB"
```

---

### Task 10: Wiring — cloud backend, backend switch, Vite plugin, Google button

**Files:**
- Create: `src/account/cloud/cloudBackend.ts`, `src/ui/AccountBadge.tsx`, `src/ui/AccountBadge.test.tsx`
- Modify: `src/main.tsx`, `vite.config.ts`, `package.json` (scripts, devDeps `@cloudflare/vite-plugin@1.64.0`, `wrangler@4.151.0`), `src/Root.tsx`

**Interfaces:**
- Consumes: Tasks 7–9.
- Produces: `createCloudBackend(): Backend`; `<AccountBadge user onSignIn? />`.

- [ ] **Step 1: Cloud backend**

`src/account/cloud/cloudBackend.ts`:
```ts
import type { Backend } from '../types'
import { createCloudAssets } from './cloudAssets'
import { createCloudAuth } from './cloudAuth'
import { createCloudBoards } from './cloudBoards'
import { createCloudPersistence } from './cloudPersistence'

/** Everything on Cloudflare, with this browser's IndexedDB as a cache in front. */
export function createCloudBackend(): Backend {
  const auth = createCloudAuth()
  const assets = createCloudAssets()
  return {
    auth: {
      ...auth,
      // Retrying uploads needs a session, so it waits for one.
      async start() {
        const session = await auth.start()
        void assets.retryPending()
        return session
      },
    },
    boards: createCloudBoards(),
    // Made once: useBoard depends on its identity.
    persistBoard: createCloudPersistence(),
    assets,
  }
}
```

- [ ] **Step 2: Backend switch**

`src/main.tsx` — replace the backend line and its comment:
```ts
// The one place that decides where data lives: Cloudflare when built with
// VITE_BACKEND=cloud (npm run dev:cloud / build:cloud), this browser otherwise.
const backend = import.meta.env.VITE_BACKEND === 'cloud' ? createCloudBackend() : createLocalBackend()
```
with `import { createCloudBackend } from './account/cloud/cloudBackend'`.

- [ ] **Step 3: Vite plugin and scripts**

```bash
npm install -D @cloudflare/vite-plugin@1.64.0 wrangler@4.151.0
```
(If npm reports an ERESOLVE peer conflict here, stop and report it — do not add `legacy-peer-deps` to the root.)

`vite.config.ts`:
```ts
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig(({ mode }) => {
  // Only the cloud build runs the Worker; plain dev, tests and e2e never load Cloudflare tooling.
  const cloud = loadEnv(mode, process.cwd(), '').VITE_BACKEND === 'cloud'
  return {
    plugins: [react(), ...(cloud ? [cloudflare({ configPath: './worker/wrangler.jsonc' })] : [])],
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.ts'],
      exclude: ['**/node_modules/**', 'e2e/**', 'worker/**'],
    },
  }
})
```

`package.json` scripts — add:
```json
    "dev:cloud": "VITE_BACKEND=cloud vite",
    "build:cloud": "tsc -b && VITE_BACKEND=cloud vite build",
    "deploy": "npm run build:cloud && wrangler deploy",
```
and change `"lint"` to `"eslint src e2e worker/src worker/test"`.

- [ ] **Step 4: Failing test for the badge**

`src/ui/AccountBadge.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AccountBadge } from './AccountBadge'

describe('AccountBadge', () => {
  it('offers Google sign-in to an anonymous user when the backend supports it', () => {
    const onSignIn = vi.fn()
    render(<AccountBadge user={{ id: 'u', kind: 'anonymous', createdAt: 0 }} onSignIn={onSignIn} />)
    fireEvent.click(screen.getByTestId('sign-in-google'))
    expect(onSignIn).toHaveBeenCalled()
  })

  it('shows nothing for an anonymous user without Google support', () => {
    const { container } = render(<AccountBadge user={{ id: 'u', kind: 'anonymous', createdAt: 0 }} />)
    expect(container.textContent).toBe('')
  })

  it('shows who is signed in', () => {
    render(<AccountBadge user={{ id: 'u', kind: 'google', createdAt: 0, name: 'Ada', email: 'ada@x.io' }} />)
    expect(screen.getByTestId('account-name').textContent).toBe('Ada')
  })
})
```
Run → FAIL.

- [ ] **Step 5: Implement the badge**

Read `src/ui/Home.tsx` first and reuse its `font`, `ink`, `paper` helpers (import them if exported; otherwise copy the same values). `src/ui/AccountBadge.tsx`:
```tsx
import type { User } from '../account/types'

type Props = { user: User; onSignIn?: () => void }

/** Top-right of home: "Sign in with Google" while anonymous, the account's name after. */
export function AccountBadge({ user, onSignIn }: Props) {
  const box: React.CSSProperties = { position: 'fixed', top: 16, right: 16, zIndex: 10 }
  if (user.kind === 'anonymous') {
    if (!onSignIn) return null
    return (
      <button
        data-testid="sign-in-google"
        onClick={onSignIn}
        title="Keep your boards and open them on any device"
        style={{ ...box, padding: '8px 12px', borderRadius: 8, border: '2px solid currentColor', background: 'transparent', cursor: 'pointer' }}
      >
        Sign in with Google
      </button>
    )
  }
  return (
    <div data-testid="account-name" style={{ ...box, padding: '8px 12px' }}>
      {user.name || user.email}
    </div>
  )
}
```
Run the test → pass.

- [ ] **Step 6: Render it from Root**

In `src/Root.tsx`, home branch:
```tsx
  const signIn = backend.auth.signInWithGoogle
  return (
    <>
      <Home … unchanged props … />
      <AccountBadge user={user} onSignIn={signIn ? () => void signIn().catch(report) : undefined} />
    </>
  )
```
Check the home screen visually in Step 8: if the badge overlaps Home's own top-right controls, move it into Home's sidebar instead (pass it through a new optional `accountSlot?: React.ReactNode` prop rendered under the "brainboard." wordmark).

- [ ] **Step 7: Run the suite** — `npm test && npm run typecheck && npm run lint && npm run build && npm run e2e` → all pass (e2e still uses the local backend).

- [ ] **Step 8: Run it for real**

```bash
cp worker/.dev.vars.example worker/.dev.vars   # put a real random BETTER_AUTH_SECRET in it
npm --prefix worker run migrate:local
npm run dev:cloud
```
Open http://localhost:5173 in the browser and verify: a session is minted (Network: `POST /api/auth/sign-in/anonymous` 200), create a board, add text and an image, reload → still there; open DevTools → Application → clear IndexedDB, reload → board and image come back from the server; stop the dev server's network (DevTools offline) → "Offline" note appears and edits still work; back online → it disappears.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vite.config.ts src
git commit -m "Wire the cloud backend behind VITE_BACKEND, with Google sign-in on home"
```

---

### Task 11: Upload boards from this browser

**Files:**
- Create: `src/account/cloud/importLocal.ts`, `src/account/cloud/importLocal.test.ts`, `src/ui/ImportBanner.tsx`
- Modify: `src/account/types.ts` (`Backend.importLocal?`), `src/account/cloud/cloudBackend.ts`, `src/account/AccountProvider.tsx` (`reloadBoards`), `src/Root.tsx`

**Interfaces:**
- Produces:
  - `Backend.importLocal?: { find(): Promise<BoardRecord[]>; run(userId: UserId, boards: BoardRecord[]): Promise<number> }`
  - `createImporter(deps: ImportDeps)` returning that object, where `ImportDeps = { localBoards: () => Promise<BoardRecord[]>; localPreview: (b: BoardRecord) => Promise<BoardPreview | null>; openLocal: (boardId: string, doc: Y.Doc) => Persistence; cloud: Pick<Backend, 'boards' | 'persistBoard' | 'assets'> }`
  - `Account.reloadBoards(): Promise<void>`
  - `IMPORT_OFFERED_KEY = 'bb_import_offered'` (localStorage flag)

- [ ] **Step 1: Failing test**

`src/account/cloud/importLocal.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { nodesMap } from '../../document/schema'
import type { BoardRecord } from '../types'
import { createImporter } from './importLocal'

const rec = (id: string, title: string): BoardRecord => ({ id, ownerId: 'local', title, createdAt: 1, openedAt: 1 })

describe('createImporter', () => {
  it('copies each local board into a new cloud board, with its media and preview', async () => {
    const source = new Y.Doc()
    const node = new Y.Map<unknown>()
    node.set('assetId', 'asset1')
    nodesMap(source).set('n1', node)
    const sourceState = Y.encodeStateAsUpdate(source)

    const pushed: Uint8Array[] = []
    const cloud = {
      boards: { create: vi.fn().mockResolvedValue(rec('cloud1', 'Mine')), savePreview: vi.fn().mockResolvedValue(undefined) },
      persistBoard: (doc: Y.Doc) => {
        pushed.push(Y.encodeStateAsUpdate(doc))
        return { whenSynced: Promise.resolve(), whenServerSynced: Promise.resolve(), destroy: async () => {} }
      },
      assets: { get: vi.fn().mockResolvedValue(new Blob(['x'])), put: vi.fn().mockResolvedValue(undefined) },
    }
    const importer = createImporter({
      localBoards: async () => [rec('default', 'Mine')],
      localPreview: async () => ({ image: null, nodes: 1, media: 1, savedAt: 5 }),
      openLocal: (_id, doc) => {
        Y.applyUpdate(doc, sourceState)
        return { whenSynced: Promise.resolve(), destroy: async () => {} }
      },
      cloud: cloud as never,
    })

    expect(await importer.find()).toHaveLength(1)
    expect(await importer.run('u1', await importer.find())).toBe(1)

    expect(cloud.boards.create).toHaveBeenCalledWith('u1', 'Mine')
    const copy = new Y.Doc()
    Y.applyUpdate(copy, pushed[0]!)
    expect(nodesMap(copy).has('n1')).toBe(true)
    expect(cloud.assets.put).toHaveBeenCalledWith('asset1', expect.any(Blob))
    expect(cloud.boards.savePreview).toHaveBeenCalledWith('u1', 'cloud1', { image: null, nodes: 1, media: 1 })
  })
})
```
Run → FAIL.

- [ ] **Step 2: Implement the importer**

`src/account/cloud/importLocal.ts`:
```ts
import * as Y from 'yjs'
import { persistDoc, type Persistence } from '../../document/persistence'
import { nodesMap } from '../../document/schema'
import { createLocalBoards } from '../localBoards'
import { BOARDS, getAll, localDb } from '../localDb'
import type { Backend, BoardPreview, BoardRecord, UserId } from '../types'

export const IMPORT_OFFERED_KEY = 'bb_import_offered'

export type ImportDeps = {
  localBoards: () => Promise<BoardRecord[]>
  localPreview: (b: BoardRecord) => Promise<BoardPreview | null>
  openLocal: (boardId: string, doc: Y.Doc) => Persistence
  cloud: Pick<Backend, 'boards' | 'persistBoard' | 'assets'>
}

function assetIds(doc: Y.Doc): string[] {
  const ids: string[] = []
  for (const node of nodesMap(doc).values()) {
    const id = node.get('assetId')
    if (typeof id === 'string') ids.push(id)
  }
  return ids
}

/**
 * Copies boards made with the in-browser backend into the signed-in cloud
 * account. Each gets a fresh server id rather than keeping its own — the
 * pre-accounts board is `default` in every browser — so its contents are
 * copied into a new document, not adopted in place. The local originals are
 * left alone.
 */
export function createImporter(deps: ImportDeps) {
  return {
    find: deps.localBoards,

    /** Returns how many boards were copied. */
    async run(userId: UserId, boards: BoardRecord[]): Promise<number> {
      let copied = 0
      for (const b of boards) {
        const source = new Y.Doc()
        const local = deps.openLocal(b.id, source)
        await local.whenSynced
        const state = Y.encodeStateAsUpdate(source)
        const media = assetIds(source)
        await local.destroy()

        const made = await deps.cloud.boards.create(userId, b.title)
        const target = new Y.Doc()
        Y.applyUpdate(target, state)
        const remote = deps.cloud.persistBoard(target, made.id)
        await remote.whenSynced
        await remote.whenServerSynced
        await remote.destroy()

        for (const id of media) {
          const blob = await deps.cloud.assets.get(id)
          if (blob) await deps.cloud.assets.put(id, blob)
        }
        const preview = await deps.localPreview(b)
        if (preview) await deps.cloud.boards.savePreview(userId, made.id, { image: preview.image, nodes: preview.nodes, media: preview.media })
        copied++
      }
      return copied
    },
  }
}

/** The importer wired to this browser's real local stores. */
export function browserImporter(cloud: ImportDeps['cloud']) {
  const open = localDb()
  const local = createLocalBoards(open)
  return createImporter({
    localBoards: () => getAll<BoardRecord>(open, BOARDS),
    localPreview: (b) => local.getPreview(b.ownerId, b.id),
    openLocal: persistDoc,
    cloud,
  })
}
```

Run the test → pass.

- [ ] **Step 3: Backend + account plumbing**

`src/account/types.ts` — add to `Backend`:
```ts
  /** Copies boards made in this browser before the cloud backend into the account. Cloud only. */
  importLocal?: {
    find(): Promise<BoardRecord[]>
    run(userId: UserId, boards: BoardRecord[]): Promise<number>
  }
```
`src/account/cloud/cloudBackend.ts` — build the object first, then:
```ts
  const backend: Backend = { auth: …, boards: …, persistBoard: …, assets }
  backend.importLocal = browserImporter(backend)
  return backend
```
`src/account/AccountProvider.tsx` — add `reloadBoards: () => Promise<void>` to `Account`:
```ts
  const reloadBoards = useCallback(async () => {
    const s = latest.current
    if (!s) return
    const boards = await backend.boards.list(s.user.id)
    setState((prev) => prev && { ...prev, boards })
  }, [backend])
```
and include it in the memoised `account` object and its dependency list.

- [ ] **Step 4: Banner**

`src/ui/ImportBanner.tsx`:
```tsx
type Props = { count: number; busy: boolean; onImport: () => void; onDismiss: () => void }

/** A one-time offer, on home, to copy this browser's boards into the account. */
export function ImportBanner({ count, busy, onImport, onDismiss }: Props) {
  return (
    <div
      data-testid="import-banner"
      role="status"
      style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px', borderRadius: 10, background: 'rgba(0,0,0,0.8)', color: '#fff', zIndex: 10 }}
    >
      <span>
        Upload {count} board{count === 1 ? '' : 's'} from this browser to your account?
      </span>
      <button data-testid="import-yes" disabled={busy} onClick={onImport}>
        {busy ? 'Uploading…' : 'Upload'}
      </button>
      <button data-testid="import-no" disabled={busy} onClick={onDismiss}>
        Not now
      </button>
    </div>
  )
}
```
(Reuse Home's palette/font helpers as in Task 10 Step 5.)

In `src/Root.tsx`:
```tsx
  const { reloadBoards } = useAccount() // add to the existing destructure
  const [importable, setImportable] = useState<BoardRecord[]>([])
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!backend.importLocal || localStorage.getItem(IMPORT_OFFERED_KEY)) return
    backend.importLocal.find().then(setImportable, report)
  }, [backend])

  const finishImport = () => {
    localStorage.setItem(IMPORT_OFFERED_KEY, '1')
    setImportable([])
  }
  const runImport = async () => {
    setImporting(true)
    try {
      await backend.importLocal!.run(user.id, importable)
      await reloadBoards()
      finishImport()
    } catch (err) {
      report(err)
    } finally {
      setImporting(false)
    }
  }
```
and in the home branch, after `<AccountBadge … />`:
```tsx
      {importable.length > 0 && (
        <ImportBanner count={importable.length} busy={importing} onImport={() => void runImport()} onDismiss={finishImport} />
      )}
```
(A failed import leaves the flag unset, so the banner is offered again next time; boards already copied before the failure would be copied again — acceptable for a one-off, and noted in the README.)

- [ ] **Step 5: Run** — `npm test && npm run typecheck && npm run lint && npm run e2e` → pass.

- [ ] **Step 6: Manual check** — with `npm run dev` (local) make a board with an image; then `npm run dev:cloud` in the same browser → banner offers 1+ boards → Upload → they appear on home with pictures; open one → contents and image present.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "Offer to upload this browser's boards on the first cloud start"
```

---

### Task 12: CI, README, spec touch-ups

**Files:**
- Modify: `.github/workflows/ci.yml`, `README.md`, `docs/superpowers/specs/2026-10-14-cloudflare-backend-design.md`

- [ ] **Step 1: CI job for the worker**

In `.github/workflows/ci.yml`, add a job before `ci:`:
```yaml
  worker:
    name: Worker
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
          cache-dependency-path: |
            package-lock.json
            worker/package-lock.json
      - run: npm ci --no-audit --no-fund
        working-directory: worker
      - run: npm run typecheck
        working-directory: worker
      - run: npm test
        working-directory: worker
```
Add `worker` to `ci.needs`. The `lint` job now lints `worker/src` too, so add `- run: npm ci --no-audit --no-fund --prefix worker` before `npm run lint` there (type imports from `cloudflare:*` don't need resolving for non-type-aware lint, but `partyserver` etc. are imported by path — if lint passes without the install, drop that line).

- [ ] **Step 2: README**

Replace the intro's "Everything runs in the browser — no server, no account, no network path." paragraph with a short "Backends" section:
```md
## Backends

The app runs against one of two backends, picked at build time (`src/main.tsx`):

- **local** (default: `npm run dev`, tests, e2e) — everything in this browser's IndexedDB.
- **cloud** (`npm run dev:cloud`, `npm run deploy`) — a Cloudflare Worker in `worker/`: Better Auth
  (anonymous users, Google sign-in) on D1, media and previews in R2, and one Durable Object per board
  holding its Yjs document. The browser keeps an IndexedDB copy of each board as a cache.

First-time cloud setup:

1. `cd worker && npm install && cp .dev.vars.example .dev.vars` and set `BETTER_AUTH_SECRET`
   (`openssl rand -base64 32`).
2. `npm run migrate:local`, then from the root `npm run dev:cloud`.
3. For Google sign-in: create an OAuth client (Web) in Google Cloud with redirect URIs
   `http://localhost:5173/api/auth/callback/google` and `https://<your-worker-host>/api/auth/callback/google`;
   put the id/secret in `.dev.vars`.

Deploying:

1. `npx wrangler login`; `npx wrangler d1 create brainboard` and paste the id into `worker/wrangler.jsonc`;
   `npx wrangler r2 bucket create brainboard`.
2. `cd worker && npm run migrate:remote`.
3. `npx wrangler secret put BETTER_AUTH_SECRET` (and the two Google ones), run from `worker/`.
4. `npm run deploy` from the root.
```

- [ ] **Step 3: Spec touch-ups** — in the spec, replace the `.env.production` sentence under "Backend choice at startup" with the `dev:cloud` / `build:cloud` scripts, and in the error table replace the "WebSocket 403" row with: "Board deleted elsewhere while open → socket refused (404); edits stay local; on next load it's gone from the list and Root sends you home."

- [ ] **Step 4: Full verification**

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run e2e
cd worker && npm run typecheck && npm test
```
All green.

- [ ] **Step 5: Commit**

```bash
git add .github README.md docs
git commit -m "CI and docs for the Cloudflare backend"
```

---

### Task 13 (needs the user): First deploy

Not automatable without the user's Cloudflare and Google accounts. Walk the user through README "Deploying" steps 1–4, then verify on the deployed URL: anonymous session, create board, Google sign-in keeps the board, second browser signed into the same Google account sees it with its media.
