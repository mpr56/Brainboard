# Cloudflare backend — design

Date: 2026-10-14 · Branch: `task/3-user-management`

## Goal

Boards live in the cloud under a real account. A first visit gets an anonymous user with no
sign-up step; signing in with Google upgrades that user so the same boards follow them to any
device. The canvas keeps working offline and opens instantly, as it does today.

Live multi-user editing is **not** in this version, but the storage chosen here (one Durable
Object per board running a Yjs room) is the same one live collab will use, so adding it later
is a permissions change, not a rewrite.

### Success criteria

1. A fresh browser opens the app, gets an anonymous user, and can create, rename, open, delete
   boards, add text and media — all persisted server-side.
2. "Sign in with Google" keeps every board the anonymous user had.
3. Signing in with the same Google account on a second browser shows those boards, contents and
   media included.
4. A board already opened on this device opens and is editable with the network off; edits made
   offline reach the server when it comes back.
5. Existing boards in this browser's IndexedDB are offered for upload on the first cloud start.
6. `npm test`, `npm run e2e`, lint, typecheck and build stay green; the e2e suite keeps running
   against the local backend with no Cloudflare account.

### Out of scope

Live collaboration and sharing boards with other users; presence/cursors; deleting orphaned
media; account deletion UI; email/password sign-in; custom domain.

## Constraints and decisions so far

- Supabase is out (project limit). Cloudflare: Workers + D1 + R2 + Durable Objects.
- Auth via **Better Auth** (anonymous + Google plugins, D1 through its Kysely dialect).
- The app already isolates storage behind `Backend` (`src/account/types.ts`); `main.tsx` is the
  only place that picks one. The cloud backend is a second implementation of that type.
- `createLocalBackend()` stays: it is the offline/test backend and what e2e runs against.

## Architecture

```
browser ──same origin──▶ Worker (worker/)
                          ├─ /api/auth/*        Better Auth  ──▶ D1 (user, session, account, verification)
                          ├─ /api/boards…       board registry ─▶ D1 (boards)
                          ├─ /api/assets/:id    media bytes   ──▶ R2  assets/{id}   + D1 (assets: id → owner)
                          ├─ /api/boards/:id/preview           ─▶ R2  previews/{boardId}
                          ├─ /parties/board-room/:id WebSocket ─▶ BoardRoom Durable Object (YServer)
                          │                                        └─ DO SQLite: the board's Yjs state
                          └─ everything else    static assets (the Vite build)
```

**Same origin.** The Worker serves the built SPA as static assets, so the session cookie is a
plain first-party cookie: no CORS, no third-party-cookie problems in Safari. In development
`@cloudflare/vite-plugin` runs the Worker inside `vite dev` with local D1/R2/DO (Miniflare), so
there is still one dev server.

**Backend choice at startup.** `main.tsx` reads `import.meta.env.VITE_BACKEND` (`cloud` |
`local`). Unset means `local`. `npm run dev:cloud` / `npm run build:cloud` set `cloud` (and only
then load `@cloudflare/vite-plugin`). Playwright keeps using plain `npm run dev`, so e2e stays local.

## Components

### Worker (`worker/`, new)

- `worker/index.ts` — entry. Routes `/api/auth/*` to Better Auth, `/api/*` to a small router,
  `/parties/*` through `routePartykitRequest` with an `onBeforeConnect` that requires a session
  and board ownership (403 otherwise). Exports the `BoardRoom` class.
- `worker/auth.ts` — `createAuth(env)` built **per request** (the D1 binding is per request).
  Plugins: `anonymous({ onLinkAccount })`, Google social provider. `onLinkAccount` runs
  `UPDATE boards SET owner_id = :new WHERE owner_id = :anon` and the same for `assets`, in one
  D1 batch.
- `worker/boards.ts` — list/create/rename/markOpened/remove; every query has
  `WHERE owner_id = :sessionUser`. A board not owned is a 404, the same as one that doesn't
  exist. `remove` deletes the row, the preview object, and tells the room to wipe its storage.
- `worker/assets.ts` — `PUT` writes R2 and an `assets` row owned by the caller (a `PUT` to an id
  owned by someone else is 403; same-owner re-`PUT` is a no-op). `GET` checks ownership and
  streams from R2 with `Cache-Control: private, max-age=31536000, immutable` (asset ids are
  content-independent random ids, never reused).
- `worker/room.ts` — `class BoardRoom extends YServer`: `onLoad` reads the stored update from
  `this.ctx.storage` (DO SQLite) and applies it; `onSave` writes
  `Y.encodeStateAsUpdate(this.document)`. Saving the merged state (not appending updates) keeps
  the stored size bounded by the board, not its history.
- `worker/schema.sql` + `migrations/` — Better Auth's tables, plus:

  ```sql
  boards (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL,
          created_at INTEGER NOT NULL, opened_at INTEGER NOT NULL,
          preview_nodes INTEGER, preview_media INTEGER, preview_saved_at INTEGER)
  assets (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL)
  CREATE INDEX boards_owner ON boards(owner_id);
  ```

- `wrangler.jsonc` — bindings `DB` (D1), `BUCKET` (R2), `BOARD_ROOM` (DO, SQLite class),
  static assets from `dist/`, secrets `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`.

### Client (`src/account/cloud/`, new)

- `cloudAuth.ts` — `AuthProvider` over the Better Auth client. `start()`: `getSession()`; if none,
  `signIn.anonymous()`. Maps the Better Auth user to our `User`.
- `cloudBoards.ts` — `BoardRepository` over `fetch('/api/boards…')`. The `userId` argument is
  kept for the interface but the server trusts only the session.
- `cloudPersistence.ts` — `persistBoard(doc, id)` attaches **both** `IndexeddbPersistence`
  (the existing local cache, keyed by board id) and a y-websocket `WebsocketProvider` to
  `/parties/board-room/:id` (y-partyserver speaks y-websocket's protocol, so the app doesn't
  depend on y-partyserver).
  `whenSynced` resolves on the IndexedDB load, so a cached board opens with no network wait;
  the socket merges in the background and Yjs reconciles both ways. A board never opened on
  this device has nothing cached; it shows as empty until the socket syncs (a spinner on first
  open is enough).
- `cloudAssets.ts` — `AssetBackend` over `/api/assets/:id`, with the existing IndexedDB store
  in front as a read-through/write-through cache (so media also works offline once seen).
- `cloudBackend.ts` — `createCloudBackend()` composes the four.
- `importLocal.ts` — on the first cloud start (flag in localStorage), if the local registry has
  boards, show a one-line banner: "Upload N boards from this browser?" Accepting creates each
  board in the cloud, applies its local Yjs state into the new room, and uploads the assets its
  media nodes reference.

### Changes to existing code

- `types.ts` — `User.kind: 'anonymous' | 'google'`, plus optional `email`/`name`.
  `AuthProvider` gains optional `signInWithGoogle?(): Promise<void>` (a redirect) and the comment
  about ids surviving the upgrade is rewritten: **the id changes; boards are moved to the new
  user server-side.**
- `main.tsx` — pick the backend from `VITE_BACKEND`.
- Home screen — a "Sign in with Google" button when `user.kind === 'anonymous'` and the backend
  supports it; the user's name/email otherwise.
- `vite.config.ts` — add the Cloudflare plugin (only when `VITE_BACKEND=cloud`, so e2e and
  unit tests don't need Wrangler).

## Data flow

**First visit:** `start()` → no session → `POST /api/auth/sign-in/anonymous` → cookie set →
`GET /api/boards` → `[]` → (import banner if local boards exist).

**Open board:** `persistBoard` → IndexedDB cache loads → canvas renders → WebSocket upgrade →
Worker checks session + ownership → `BoardRoom.onLoad` → Yjs sync step 1/2 exchanges missing
updates both ways → edits stream to the room → `onSave` debounced (2 s, max 10 s) and on last
disconnect.

**Add media:** ingest writes to the IndexedDB cache and `PUT /api/assets/:id`. A failed upload is
retried on next app start from a small pending-uploads list in IndexedDB.

**Google sign-in:** button → `signIn.social({ provider: 'google' })` → Google → callback →
Better Auth creates (or finds) the Google user, fires `onLinkAccount` → boards/assets re-owned →
redirect back → `start()` returns the Google user → board list reloads.

## Error handling

| Situation | Behaviour |
|---|---|
| Offline at startup, session cookie present | Board list fetch fails → existing account-error screen, with "Retry". (Offline board *list* is out of scope; offline *editing* of an open board works.) |
| Socket drops mid-edit | y-websocket reconnects with backoff; edits are safe in IndexedDB meanwhile. An "Offline" note shows at the bottom left. It follows the browser's offline/online events too, because a dropped network can leave the socket looking open for up to 30 s. |
| Board deleted elsewhere while open | The socket is refused (404); edits stay local. On the next load the board is gone from the list and Root sends you home. |
| Asset `PUT` fails | Kept in the pending list, retried on next start; the node still shows from the local cache. |
| Asset `GET` 404 | Same as today's missing-bytes path (`assetUrl` → null). |
| Upload too large | Workers cap request bodies (100 MB on the free plan). The client rejects files over 95 MB at ingest with a message. |
| Google account already has boards | Anonymous boards are merged into it (re-owned); nothing is lost. |
| Session expired | API returns 401 → `start()` again; an expired anonymous session mints a new anonymous user, so anonymous data is only as durable as its cookie — the Google sign-in button is the way to keep it. |

## Testing

- **Worker:** `@cloudflare/vitest-pool-workers` — runs in workerd with real local D1/R2/DO.
  Covers ownership on every route, `onLinkAccount` re-owning, room load/save round trip, delete
  wiping storage. Separate vitest project (`worker/vitest.config.ts`).
- **Client:** unit tests for `cloudBoards`/`cloudAssets` against a stubbed `fetch`;
  `cloudPersistence` with two `Y.Doc`s and a fake provider; the import flow with
  `fake-indexeddb`. Existing `AccountProvider` tests run against both backends where cheap.
- **E2E:** unchanged, local backend. One optional smoke spec (`e2e/cloud.spec.ts`), skipped
  unless `VITE_BACKEND=cloud`, that creates a board, reloads, and sees it.
- **CI:** add the worker test project to `npm test`. Deploy (`wrangler deploy` on push to
  `main`, needing a `CLOUDFLARE_API_TOKEN` secret) is the last step and can wait.

## Things you'll need to do by hand

1. Cloudflare account; `npx wrangler login`.
2. Google Cloud OAuth client (Web), redirect URI `https://<worker-host>/api/auth/callback/google`
   and `http://localhost:5173/api/auth/callback/google`.
3. `wrangler secret put` for the three secrets.
