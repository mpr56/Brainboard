# Brainstorm Canvas

A local-first brainstorming canvas: an infinite pan/zoom board of text nodes joined by connectors,
with undo/redo and automatic persistence to IndexedDB. It runs entirely in the browser by default;
built for the cloud backend, boards also sync to a Cloudflare Worker under an anonymous or Google
account (see [Backends](#backends)).

This repository contains **Plan 1 (canvas core)** and the first part of **Plan 2**: media nodes
(image, GIF, video, audio, PDF). Time-anchored links are not built yet.

- Design spec: [`docs/superpowers/specs/2026-09-21-brainstorm-canvas-design.md`](docs/superpowers/specs/2026-09-21-brainstorm-canvas-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-09-21-canvas-core.md`](docs/superpowers/plans/2026-09-21-canvas-core.md)

## Stack

React 19 + TypeScript + Vite, with [Yjs](https://github.com/yjs/yjs) as the document model
(`y-indexeddb` for persistence, `Y.UndoManager` for undo). Vitest + jsdom for unit tests,
Playwright for end-to-end tests.

## Running it

```sh
npm install
npm run dev        # dev server on http://localhost:5173
npm test           # unit tests (vitest, jsdom)
npm run e2e        # end-to-end tests (playwright; starts the dev server itself)
npx tsc --noEmit   # type check
npm run build      # production build into dist/
npm run preview    # serve the production build on http://localhost:4173
```

The board lives in IndexedDB under `brainstorm-canvas/default`. Deleting that database resets it.

## Backends

The app runs against one of two backends, picked at build time in `src/main.tsx`:

- **local** (`npm run dev`, unit tests, e2e): everything in this browser's IndexedDB.
- **cloud** (`npm run dev:cloud`, `npm run build:cloud`, `npm run deploy`): the Cloudflare Worker in
  `worker/`. Better Auth (anonymous users, Google sign-in) on D1, media and previews in R2, and one
  Durable Object per board holding its Yjs document. The browser keeps an IndexedDB copy of each
  board and file as a cache, so boards open instantly and keep working offline. The first cloud start
  offers to upload boards already in this browser.

`worker/` is its own npm package (it needs vitest 4 and the Workers runtime):

```sh
cd worker
npm install
npm test           # worker tests, in workerd with local D1/R2/Durable Objects
npm run typecheck  # regenerates worker-configuration.d.ts, then tsc
```

### Running the cloud backend locally

1. `cd worker && cp .dev.vars.example .dev.vars`, and set `BETTER_AUTH_SECRET` (`openssl rand -base64 32`).
2. From the root: `npx wrangler d1 migrations apply brainboard --local -c worker/wrangler.jsonc --persist-to .wrangler/state`.
3. `npm run dev:cloud`, open http://localhost:5173.
4. `npx playwright test e2e/cloud.spec.ts` runs the cloud smoke test against it (it skips itself on the local backend).

Google sign-in needs an OAuth client (Web application) from Google Cloud with redirect URIs
`http://localhost:5173/api/auth/callback/google` and `https://<your-worker-host>/api/auth/callback/google`.
Put its id and secret in `worker/.dev.vars`. Without them the "Sign in with Google" button returns an error.

### Deploying

1. `npx wrangler login`.
2. `npx wrangler d1 create brainboard`, and paste the database id into `worker/wrangler.jsonc` in place of `"local"`.
3. `npx wrangler r2 bucket create brainboard`.
4. `cd worker && npm run migrate:remote`.
5. From `worker/`: `npx wrangler secret put BETTER_AUTH_SECRET`, and the same for `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
6. `npm run deploy` from the root.

If uploading this browser's boards fails partway, the offer comes back on the next start and picks
up where it stopped: finished boards are skipped, and a half-copied one is completed in place.

## Using it

| Action | How |
|---|---|
| Add something | Double-click empty canvas: a small wheel opens. Swipe **left** for text, **right** for media (or click a side, or press ← / →). `Esc` closes it |
| Add a text node | Pick **Text** from the wheel, or **+ Text** — it appears ready to type into. It starts empty; "New idea" is only a placeholder |
| Add media | Pick **Media** from the wheel to choose files, or drop them onto the board, or paste one (a screenshot, say). Images, GIFs, video, audio and PDFs. Media sits on the board as itself, with no card round it |
| Play a video / audio | The bar along its bottom (over a video, it shows while paused or hovered): play / pause, and click or drag the track to seek |
| Read a PDF | Double-click it to scroll and page through; click off it to go back to moving it |
| Resize media | Hover it and drag the square grip at its bottom-right. Pictures and videos keep their proportions |
| Add a linked child | Hover a node, then **click** one of its four `+` handles |
| Connect two nodes | Hover a node, then **drag** a `+` handle onto another node |
| Add and connect at once | Drag a `+` handle onto empty canvas — the node is created where you let go |
| Edit text | Double-click a node; click elsewhere or press `Esc` to finish |
| Format text | While editing, use the bar above the node: Heading / Sub / Body / Small, `A−` / `A+`, **B** / *I* / U — or `⌘B` / `⌘I` / `⌘U` |
| Text without a box | While editing, the dashed-square button at the end of the format bar toggles the card off and on |
| Colour a branch | Click a node, pick from the colour wheel above it; **Auto** returns it to the branch colour. `Esc` closes it |
| Select a link | Click it. The colour wheel recolours just that link (and the branch below it); the **×** on the link, or `Delete`, removes it |
| Move nodes | Drag them; drag empty canvas to marquee-select |
| Delete one node | Hover it and click the **×** at its top-right |
| Delete a selection | Select, then `Delete` / `Backspace` |
| Connector style | The toolbar's style button cycles curve → arrow → elbow → straight |
| Pan | Middle-drag, or two-finger scroll |
| Zoom | ⌘/Ctrl + wheel, or the toolbar's zoom buttons |
| Fit everything | **Fit**, or `⇧1` — frames the whole board, centred, as large as it will go (up to 150%) |
| Export | **Export** — PNG, JPEG or PDF; board-coloured, white or transparent (PNG) background; plain, dotted, grid or lined paper; 1–3× resolution; the whole board or just the selection |
| Save / copy a whole board | **Export** → **Download board file (.json)** saves everything on the board, media included; **Import** on home makes a new board from that file, identical to the original |
| Undo / redo | `⌘Z` / `⇧⌘Z`, or the toolbar buttons |

A swipe to **Media** opens the file chooser only within a few seconds of the double-click — browsers
allow a page to open one only just after a real press. Later than that, Media lights up and waits
for a click.

There is no tool mode to be in. Which gesture you get is decided by what you press: a `+` handle
draws a link, anything else selects and moves. The toolbar has no tool buttons, and `v` / `c` are
gone with them.

A node's four handles appear on hover, one per side, and the side you reach for is the direction
the new node goes — click the east handle and the child appears to the east, on the parent's axis.
Hovering starts 24px outside the node on every edge — out to the middle of the handles — so the
handles do not vanish as you reach for them. That margin is hover-only: pressing in it starts a marquee, not a grab on the node.

`Delete` is deliberately inert while a node is open for editing, and every node you create opens
that way — so the **×** is the way to remove a node you have only just made.

Connectors are drawn as tapered ribbons: wide where they leave their source, narrow where they
arrive. That taper is what shows direction, so there are no arrowheads — except in the **arrow**
style, which is the same curve drawn as a thin line with a small head. Colour follows the branch —
a connector takes the colour of its source's *parent link*, and only a node with no parent link
starts a new colour, cycling an eight-entry palette. A node's parent link is the first link to
arrive at it, but only if it arrived before the node had any branches of its own: linking something
into a hub that already has branches does not repaint them. While you drag one out, the preview is
the same shape in the same colour, so you see what you are about to commit.

Each node wears its branch's colour too — on its border and faintly across its card. A root has
branches of several colours, so it stays ink unless you give it a colour of its own.

Colours are resolved when the board is painted, not read off each stored connector. A node picked
from the colour wheel colours the connector arriving at it and everything downstream, until another
node with its own colour takes over. A link given its own colour (`edge.color`) beats both. Connectors leaving a root keep the palette colour they were
drawn with. Boards from before branch colours stored every connector as `#1a1a1a`; that value is
treated as "no colour chosen", so those boards pick up palette colours too.

Formatting — size, bold, italic, underline — belongs to the whole node and lives in its `props`
next to `text`. The editor still commits plain text, so there is no stored markup.

A node can also drop its card (`props.boxless`) and sit on the board as bare, centred text. A
boxless node is as wide as its longest line, up to 260px, so connectors end at the words rather
than at an invisible 220px edge. That width is measured — rule 1's one sanctioned measurement now
reports width as well as height — and written under `'system'`, re-centred so the text stays put.
A boxed node always reports 220, which is what restores full width when the box comes back,
including by undo.

## Architecture

```
src/
  camera.ts     Camera state and ALL world<->screen math
  document/     Yjs schema, node/edge CRUD, undo manager, IndexedDB persistence
  geometry/     Anchor resolution, edge routing and link picking — pure data, no DOM
  tools/        select / connect / resize state machines over normalized world events
  render/       World layer, node views (text and media), SVG connectors, screen-space overlay
  media/        File ingest: classify, measure, store, and create media nodes
  export/       Board → canvas painter, a minimal one-image PDF writer, and board files (JSON export/import)
  ui/           Toolbar, format bar, colour wheel, link menu, export dialog
```

Four rules from spec §4 are load-bearing and enforced in review, because they are what would keep
a future move to a Canvas2D/WebGL renderer a swap rather than a rewrite:

1. Node size lives in the document, never read back from `getBoundingClientRect` as layout truth.
   The single sanctioned measurement is `TextNode`'s `scrollHeight` (plus the node's border, so
   the stored box is the drawn box), written back under the `'system'` transaction origin so it
   stays out of the undo stack.
2. All coordinate math lives in `camera.ts`. Tools never touch raw `clientX`.
3. Tools consume a normalized `WorldEvent`; `tools/hitTest.ts` is the only DOM seam.
4. Connector geometry is pure data computed in `geometry/`; SVG only paints it.

The camera is per-viewer and deliberately never stored in the Yjs document. One gesture is one
transaction is one undo step: drag state is ephemeral and committed once on pointer-up.

## Known limitations

**There is a data-loss window between an edit and a reload.** If you edit a node and reload or
close the tab in the same instant, that edit can be lost. `y-indexeddb` starts an asynchronous
IndexedDB transaction from the Yjs `update` event; the commit in the app returns before that
transaction has reached disk, and a navigation in the meantime discards it. Nothing in the app
waits for, or reports, the write landing.

Measured against a **production build** (`npm run build` + `vite preview`), editing a node and
reloading immediately with no wait at all lost the edit in **29 of 30 runs (96.7%)**, reproduced
twice for 58/60 overall. The same measurement against `npm run dev` lost 3 of 30 (10%) — the
development build is much slower to tear down and reload a page, which is why this window looked
far narrower during development than it is. With a 300 ms pause before reloading, 0 of 10 runs
lost the edit, so the write itself is sound; it is purely unacknowledged.

In practice a reload a second or more after an edit is safe. A deliberate flush-and-wait on unload,
or a visible "saved" indicator, is a product decision that has not been taken yet.

Other gaps in this milestone:

- Text nodes cannot be resized; they auto-size to their content height. Media nodes can.
- Formatting applies to a whole node; there is no inline (part-of-the-text) bold or italic.
- The colour wheel has no line-style options (Coggle's thickness / dash arcs).
- Connector labels exist in the document model but have no UI. `style.arrow` is still stored and not
  read — the arrow is a board-wide style.
- There is one board (`default`); there is no board list or import.
- Media files live in a separate IndexedDB database (`brainstorm-canvas-assets`), not in the Yjs
  document, so the board stays fast to load. They are never deleted — undo can bring a deleted node
  back and it must find its file — so the store only grows.
- Time-anchored links (a link from a moment in a video) are not built.
- Export draws a video as a placeholder frame with a play button, and a PDF as its title strip; it
  does not render video frames or PDF pages.
- A board file carries its media as base64 inside the JSON, so a board with large videos makes a
  large file (about a third bigger than the media itself). It holds the board as it is, not its
  undo history.
- If IndexedDB is unavailable (private browsing, exhausted quota), the board reports an error
  rather than running in memory.
