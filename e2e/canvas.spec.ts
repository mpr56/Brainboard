import { expect, test, type Page } from '@playwright/test'
import { waitForPersisted } from './persisted'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // Each test starts from a clean board.
  await page.evaluate(async () => {
    for (const db of await indexedDB.databases()) if (db.name) indexedDB.deleteDatabase(db.name)
  })
  await page.reload()
  await expect(page.getByTestId('toolbar')).toBeVisible()
})

test('creates, edits and persists a text node', async ({ page }) => {
  await page.getByTestId('add-text').click()
  const body = page.getByTestId('text-node-body').first()
  await expect(body).toBeVisible()

  await body.dblclick()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('persisted idea')
  await page.mouse.click(600, 600) // blur commits the edit

  // y-indexeddb writes each update to IndexedDB via an async transaction
  // triggered off the Yjs 'update' event (see node_modules/y-indexeddb):
  // the write is only *started* synchronously with the commit above, not
  // finished. Reloading immediately races ahead of that transaction and
  // observes the pre-edit state — measured at 29/30 against a production
  // build, see README's "Known limitations". Waiting on the write actually
  // being on disk, rather than on an arbitrary constant, keeps this test
  // proving DoD 8 (reload restores the board from IndexedDB) without
  // asserting on a coin flip and without hiding how narrow the window is.
  await waitForPersisted(page, 'default', 'persisted idea')
  await page.reload()
  await expect(page.getByText('persisted idea')).toBeVisible()
})

test('undo removes a created node and redo restores it', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await expect(page.getByTestId('text-node-body')).toHaveCount(1)

  await page.getByTestId('undo').click()
  await expect(page.getByTestId('text-node-body')).toHaveCount(0)

  await page.getByTestId('redo').click()
  await expect(page.getByTestId('text-node-body')).toHaveCount(1)
})

/**
 * Double-clicks empty canvas and swipes left to pick Text from the picker that
 * opens. The pointer comes back to the spot afterwards, so callers that go on
 * to read positions see it where they double-clicked.
 */
async function newTextAt(page: Page, x: number, y: number) {
  await page.mouse.dblclick(x, y)
  await expect(page.getByTestId('create-picker')).toBeVisible()
  await page.mouse.move(x - 60, y, { steps: 4 })
  await expect(page.getByTestId('create-picker')).toHaveCount(0)
}

/**
 * Drags from a node's spawn handle to a point, or onto another element.
 *
 * The handle only exists to the pointer once its node is hovered
 * (pointer-events is none until then), so the hover is part of the gesture
 * rather than setup noise.
 */
async function dragFromHandle(
  page: Page,
  nodeIndex: number,
  dir: 'n' | 'e' | 's' | 'w',
  to: { x: number; y: number },
) {
  const body = page.getByTestId('text-node-body').nth(nodeIndex)
  await body.hover()
  const handle = page.locator(`[data-part="handle"][data-dir="${dir}"]`).nth(nodeIndex)
  await handle.hover()
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.up()
}

test('connects two nodes by dragging one node`s handle onto the other', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600) // end the edit session and deselect
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600)

  // Separate the two nodes so they are distinguishable.
  const bodies = page.getByTestId('text-node-body')
  await expect(bodies).toHaveCount(2)
  await bodies.nth(1).hover()
  await page.mouse.down()
  await page.mouse.move(900, 500, { steps: 10 })
  await page.mouse.up()

  const target = await bodies.nth(1).boundingBox()
  if (!target) throw new Error('expected the second node to be visible')
  await dragFromHandle(page, 0, 'e', {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  })

  await expect(page.locator('[data-edge-id]')).toHaveCount(1)
  // No new node: the drag landed on something, so it linked rather than created.
  await expect(bodies).toHaveCount(2)
})

// The whole point of the handle: a connection no longer requires having made
// the other node first, and no trip to the toolbar.
test('dragging a handle onto empty canvas creates the node and links it', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600)
  await expect(page.getByTestId('text-node-body')).toHaveCount(1)

  await dragFromHandle(page, 0, 'e', { x: 900, y: 520 })

  await expect(page.getByTestId('text-node-body')).toHaveCount(2)
  await expect(page.locator('[data-edge-id]')).toHaveCount(1)

  // Node and edge arrived together, so they must leave together.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByTestId('text-node-body')).toHaveCount(1)
  await expect(page.locator('[data-edge-id]')).toHaveCount(0)
})

test('clicking a handle spawns a linked child on that side', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600)

  const bodies = page.getByTestId('text-node-body')
  const parent = await bodies.first().boundingBox()
  if (!parent) throw new Error('expected the node to be visible')

  await bodies.first().hover()
  await page.locator('[data-part="handle"][data-dir="e"]').first().click()

  await expect(bodies).toHaveCount(2)
  await expect(page.locator('[data-edge-id]')).toHaveCount(1)

  // "East" has to mean east on screen, not merely somewhere else.
  const child = await bodies.nth(1).boundingBox()
  if (!child) throw new Error('expected the child to be visible')
  expect(child.x).toBeGreaterThan(parent.x + parent.width)
  // And on the parent's axis, not drifting off vertically.
  expect(Math.abs(child.y + child.height / 2 - (parent.y + parent.height / 2))).toBeLessThan(4)
})

test('a handle click spawns on the side the handle is on', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600)

  const bodies = page.getByTestId('text-node-body')
  const parent = await bodies.first().boundingBox()
  if (!parent) throw new Error('expected the node to be visible')

  await bodies.first().hover()
  await page.locator('[data-part="handle"][data-dir="s"]').first().click()

  const child = await bodies.nth(1).boundingBox()
  if (!child) throw new Error('expected the child to be visible')
  expect(child.y).toBeGreaterThan(parent.y + parent.height)
  expect(Math.abs(child.x + child.width / 2 - (parent.x + parent.width / 2))).toBeLessThan(4)
})

// pointer-events must stay off until the node is hovered. If it does not, the
// four handles ring every node with a dead zone that swallows marquee drags
// and clicks aimed at the canvas.
test('handles do not block the canvas when their node is not hovered', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600)

  const box = await page.getByTestId('text-node-body').first().boundingBox()
  if (!box) throw new Error('expected the node to be visible')

  // Press just outside the node's left border — exactly where the west handle
  // sits — with the pointer arriving from far away, so the node is not hovered.
  await page.mouse.move(900, 700)
  await page.mouse.down()
  await page.mouse.move(box.x - 14, box.y + box.height / 2, { steps: 2 })
  // A marquee, not a connector drag: the press landed on canvas, not a handle.
  await expect(page.getByTestId('marquee')).toBeVisible()
  await page.mouse.up()

  await expect(page.getByTestId('text-node-body')).toHaveCount(1)
  await expect(page.locator('[data-edge-id]')).toHaveCount(0)
})

test('double-clicking empty canvas and swiping to Text creates a node ready to type into', async ({
  page,
}) => {
  await expect(page.getByTestId('text-node-body')).toHaveCount(0)

  await newTextAt(page, 640, 420)
  await expect(page.getByTestId('text-node-body')).toHaveCount(1)

  // Created *where it was clicked*, not at the viewport centre like "+ Text".
  const box = await page.getByTestId('text-node-body').first().boundingBox()
  if (!box) throw new Error('expected the node to be visible')
  expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThan(6)
  expect(Math.abs(box.y + box.height / 2 - 420)).toBeLessThan(6)

  // It opens for editing, so typing goes straight in with no second gesture.
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('typed on creation')
  await page.mouse.click(200, 700)
  await expect(page.getByTestId('text-node-body').first()).toHaveText('typed on creation')
})

test('double-clicking a node still edits it rather than creating another', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600)

  const body = page.getByTestId('text-node-body').first()
  await body.dblclick()
  await expect(page.getByTestId('text-node-body')).toHaveCount(1)

  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('edited not duplicated')
  await page.mouse.click(200, 700)
  await expect(body).toHaveText('edited not duplicated')
  await expect(page.getByTestId('text-node-body')).toHaveCount(1)
})

/** Reads a tapered ribbon back into the centreline and widths it was built from. */
async function ribbonOf(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const d = document.querySelector(sel)!.getAttribute('d')!
    const pts = d
      .replace(/\s*Z$/, '')
      .split(/(?=[ML])/)
      .map((s) => s.trim().replace(/^[ML]\s*/, ''))
      .filter(Boolean)
      .map((s) => {
        const [x, y] = s.split(/\s+/).map(Number)
        return { x: x!, y: y! }
      })
    const n = pts.length / 2
    const pair = (i: number) => [pts[i]!, pts[pts.length - 1 - i]!] as const
    const mid = (p: readonly [{ x: number; y: number }, { x: number; y: number }]) => ({
      x: (p[0].x + p[1].x) / 2,
      y: (p[0].y + p[1].y) / 2,
    })
    const span = (p: readonly [{ x: number; y: number }, { x: number; y: number }]) =>
      Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y)
    return {
      start: mid(pair(0)),
      end: mid(pair(n - 1)),
      startWidth: span(pair(0)),
      endWidth: span(pair(n - 1)),
    }
  }, selector)
}

// Direction used to be carried by an arrow marker painted at the node centre,
// underneath the node's own opaque div, so no connector visibly pointed
// anywhere. The taper carries it now and cannot be occluded.
test('a connector tapers from its source to its target', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600)
  await dragFromHandle(page, 0, 'e', { x: 1000, y: 300 })

  const edge = page.locator('[data-edge-id]')
  await expect(edge).toHaveCount(1)
  // No marker to occlude, and none referenced.
  await expect(edge).not.toHaveAttribute('marker-end', /.*/)

  const r = await ribbonOf(page, '[data-edge-id]')
  expect(r.startWidth).toBeGreaterThan(r.endWidth * 2)

  // And it reaches the target's border rather than stopping at — or running
  // under — its centre, which is where it used to end.
  const target = await page.getByTestId('text-node-body').nth(1).boundingBox()
  if (!target) throw new Error('expected the target node to be visible')
  const worldEnd = await page.evaluate(() => {
    const world = document.querySelector('[data-testid="world"]')!
    return world.getBoundingClientRect()
  })
  const endOnScreen = worldEnd.x + r.end.x
  expect(endOnScreen).toBeGreaterThan(target.x - 12)
  expect(endOnScreen).toBeLessThan(target.x + target.width / 2)
})

test('connectors are coloured per branch, and children inherit', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600)

  const bodies = page.getByTestId('text-node-body')
  // Two branches off the same root get two different colours.
  await bodies.first().hover()
  await page.locator('[data-part="handle"][data-dir="n"]').first().click()
  await page.mouse.click(600, 620)
  await bodies.first().hover()
  await page.locator('[data-part="handle"][data-dir="s"]').first().click()
  await page.mouse.click(600, 620)

  await expect(page.locator('[data-edge-id]')).toHaveCount(2)
  const colors = await page
    .locator('[data-edge-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('fill')))
  expect(new Set(colors).size).toBe(2)

  // A grandchild continues its parent's branch rather than starting a new one.
  await bodies.nth(1).hover()
  await page.locator('[data-part="handle"][data-dir="e"]').nth(1).click()
  await page.mouse.click(600, 620)

  const after = await page
    .locator('[data-edge-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('fill')))
  expect(after).toHaveLength(3)
  expect(new Set(after).size).toBe(2)
})

// The preview's job is to show what you are about to commit, so it has to be
// the same shape and the same branch colour — not a generic dashed line.
test('the in-flight preview shows the tapered connector it will become', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600)

  const box = await page.getByTestId('text-node-body').first().boundingBox()
  if (!box) throw new Error('expected the node to be visible')

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.move(box.x + box.width + 11, box.y + box.height / 2, { steps: 3 })
  await page.mouse.down()
  await page.mouse.move(980, 480, { steps: 10 })

  const preview = page.getByTestId('pending-edge')
  await expect(preview).toBeVisible()
  // toBeVisible only asks for a non-zero box, which a path clipped away by its
  // own <svg> still has. The overlay must actually span the viewport: an svg
  // left to size itself is 300×150, and the preview was drawn but never seen.
  const overlay = await page.getByTestId('overlay').boundingBox()
  const pathBox = await preview.boundingBox()
  if (!overlay || !pathBox) throw new Error('expected the overlay and preview to have boxes')
  expect(overlay.x + overlay.width).toBeGreaterThanOrEqual(pathBox.x + pathBox.width)
  expect(overlay.y + overlay.height).toBeGreaterThanOrEqual(pathBox.y + pathBox.height)
  const r = await ribbonOf(page, '[data-testid="pending-edge"]')
  expect(r.startWidth).toBeGreaterThan(r.endWidth * 2)

  const previewFill = await preview.getAttribute('fill')
  await page.mouse.up()

  // The committed edge is the colour the preview promised.
  await expect(page.locator('[data-edge-id]')).toHaveCount(1)
  expect(await page.locator('[data-edge-id]').getAttribute('fill')).toBe(previewFill)
  await expect(preview).toHaveCount(0)
})

// Two clicks on a handle are two children. The guard that stops them also
// opening the parent for editing lives in App's central double-click handler,
// so this is the only place it is exercised.
test('double-clicking a handle spawns children without editing the parent', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600)

  const bodies = page.getByTestId('text-node-body')
  await bodies.first().hover()
  await page.locator('[data-part="handle"][data-dir="e"]').first().dblclick()

  await expect(bodies).toHaveCount(3)

  // The parent must not be in an edit session: typing would otherwise replace
  // its text. Delete proves the keyboard is in command mode, not typing mode.
  await expect(bodies.first()).toHaveAttribute('contenteditable', 'false')
})

// Regression: nothing disabled native text selection, so any drag across the
// board — pulling a connector, marquee-selecting, panning — also ran the
// browser's own drag-select and painted every node it swept over blue.
test('dragging a connector does not select text across the board', async ({ page }) => {
  // Three nodes strung left to right, so the drag below actually sweeps the
  // pointer over other nodes' text. A drag across empty canvas has nothing to
  // select and would pass whether or not selection is disabled.
  for (const [x, y, label] of [[220, 200, 'alpha'], [540, 205, 'beta'], [860, 210, 'gamma']] as const) {
    await newTextAt(page, x, y)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(label)
    await page.mouse.click(700, 650)
  }

  const bodies = page.getByTestId('text-node-body')
  expect(await bodies.allTextContents()).toEqual(['alpha', 'beta', 'gamma'])
  const box = await bodies.nth(0).boundingBox()
  if (!box) throw new Error('expected the first node to be visible')

  // Drag the first node's body straight through the other two. This is the
  // gesture that reproduces: measured against a build without the fix it
  // leaves a live selection ("lpha"), which is what paints the board blue.
  await page.mouse.move(box.x + 20, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(600, 205, { steps: 8 })
  await page.mouse.move(900, 215, { steps: 8 })
  await page.mouse.up()

  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
})

test('marquee-dragging across nodes does not select their text', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600)

  const box = await page.getByTestId('text-node-body').first().boundingBox()
  if (!box) throw new Error('expected the node to be visible')

  await page.mouse.move(box.x - 80, box.y - 80)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width + 80, box.y + box.height + 80, { steps: 10 })
  await page.mouse.up()

  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
})

// Selection has to come back for the node actually being edited, or the caret
// cannot be placed and select-all inside the editor does nothing — which would
// break every "select all and retype" flow in this suite.
test('text is still selectable inside the node being edited', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('replaced wholesale')
  await page.mouse.click(300, 700)
  await expect(page.getByTestId('text-node-body').first()).toHaveText('replaced wholesale')
})

test('a node can be deleted with its × button, connectors and all', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600)
  await dragFromHandle(page, 0, 'e', { x: 900, y: 500 })
  await expect(page.getByTestId('text-node-body')).toHaveCount(2)
  await expect(page.locator('[data-edge-id]')).toHaveCount(1)

  const child = page.getByTestId('text-node-body').nth(1)
  await child.hover()
  await page.locator('[data-part="delete"]').nth(1).click()

  await expect(page.getByTestId('text-node-body')).toHaveCount(1)
  // removeNode cascades: an edge pointing at a node that is gone would paint
  // nothing and break the next render that dereferences it.
  await expect(page.locator('[data-edge-id]')).toHaveCount(0)
})

// The reason the × exists at all. A node created by a handle or a double-click
// opens for editing, and the Delete key is deliberately inert while typing —
// so until now a node you had just made could not be deleted without first
// clicking away from it.
test('the × deletes a node that is still in its edit session', async ({ page }) => {
  await newTextAt(page, 640, 400)
  await expect(page.getByTestId('text-node-body')).toHaveCount(1)
  await expect(page.getByTestId('text-node-body').first()).toHaveAttribute(
    'contenteditable',
    'true',
  )

  await page.getByTestId('text-node-body').first().hover()
  await page.locator('[data-part="delete"]').first().click()
  await expect(page.getByTestId('text-node-body')).toHaveCount(0)

  // And the board must not be stuck in typing mode afterwards: a node deleted
  // while it was the one being edited used to leave editingId pointing at it,
  // which made every later keystroke count as typing.
  await page.getByTestId('add-text').click()
  await page.mouse.click(300, 700)
  await page.getByTestId('text-node-body').first().click()
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('text-node-body')).toHaveCount(0)
})

test('deleting a node is one undo step', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600)
  await dragFromHandle(page, 0, 'e', { x: 900, y: 500 })

  await page.getByTestId('text-node-body').nth(1).hover()
  await page.locator('[data-part="delete"]').nth(1).click()
  await expect(page.getByTestId('text-node-body')).toHaveCount(1)

  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByTestId('text-node-body')).toHaveCount(2)
  await expect(page.locator('[data-edge-id]')).toHaveCount(1)
})

// The halo widens the area that counts as hovering, so the handles do not
// blink out as the pointer leaves the border on its way to one.
test('handles appear from just outside the node, not only over it', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600)

  const box = await page.getByTestId('text-node-body').first().boundingBox()
  if (!box) throw new Error('expected the node to be visible')

  const east = page.locator('[data-part="handle"][data-dir="e"]').first()
  await expect(east).toHaveCSS('opacity', '0')

  // Outside the node's own box, inside the 10% halo.
  await page.mouse.move(box.x + box.width + box.width * 0.05, box.y + box.height / 2)
  await expect(east).toHaveCSS('opacity', '1')
})

// The halo must not swallow presses. It is hoverable, but hit-testing has to
// treat it as canvas or clicking near a node would grab the node and a marquee
// could never start in that space.
test('pressing inside the halo starts a marquee rather than grabbing the node', async ({
  page,
}) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600)

  const box = await page.getByTestId('text-node-body').first().boundingBox()
  if (!box) throw new Error('expected the node to be visible')

  // Left of the node, but high enough to clear the west handle — the handles
  // sit inside the halo and rightly take precedence over it, so a point under
  // one would start a connector instead and prove nothing about the halo.
  await page.mouse.move(box.x - 10, box.y + 6)
  await page.mouse.down()
  await page.mouse.move(box.x - 200, box.y - 140, { steps: 6 })
  await expect(page.getByTestId('marquee')).toBeVisible()
  await page.mouse.up()

  // And the node did not move.
  const after = await page.getByTestId('text-node-body').first().boundingBox()
  expect(after).toEqual(box)
})

// The document stores a node's size, and a view reports its real laid-out
// height back so the document stays the source of truth. A node is created at
// an *estimated* height before anything is laid out, and if that estimate is
// wrong the correction changes `h` without changing `y` — so the node settles
// off-centre from where it was asked to appear, and a spawned child misses its
// parent's axis by half the error. This pins the estimate to the measurement:
// change the font or padding without changing defaultSize and it fails here.
test('a new node`s estimated height matches the height it actually lays out to', async ({
  page,
}) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600)

  const measured = await page.evaluate(() => {
    const inner = document.querySelector<HTMLElement>('[data-testid="text-node-body"]')!
    const wrapper = inner.closest('[data-node-id]') as HTMLElement
    return {
      // The whole node as drawn, border included.
      laidOut: wrapper.offsetHeight,
      // What the document settled on, via the wrapper's minHeight.
      stored: parseFloat(wrapper.style.minHeight),
    }
  })

  // The document's box is the drawn box, border and all, so everything that
  // works from the document (connectors, Fit, export) sees the real edges.
  expect(measured.stored).toBe(measured.laidOut)
})

// DoD 3: all three routing styles must be reachable from the UI. Before the
// toolbar control, connectTool always created DEFAULT_EDGE_STYLE and only the
// geometry unit tests ever exercised the other two.
test('creates a connector with a non-default routing style', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600) // end the edit session and deselect
  await page.getByTestId('add-text').click()

  const bodies = page.getByTestId('text-node-body')
  await expect(bodies).toHaveCount(2)
  await bodies.nth(1).hover()
  await page.mouse.down()
  await page.mouse.move(900, 500, { steps: 10 })
  await page.mouse.up()

  // curve -> arrow -> elbow -> straight
  await page.getByTestId('edge-style').click()
  await page.getByTestId('edge-style').click()
  await page.getByTestId('edge-style').click()
  await expect(page.getByTestId('edge-style')).toHaveAttribute('data-edge-style', 'straight')

  const target = await bodies.nth(1).boundingBox()
  if (!target) throw new Error('expected the second node to be visible')
  await dragFromHandle(page, 0, 'e', {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  })

  const path = page.locator('[data-edge-id]')
  await expect(path).toHaveCount(1)
  await expect(path).toHaveAttribute('data-edge-style', 'straight')

  // A straight connector's centreline must not bow. Connectors are painted as
  // filled ribbons now, so this reads the shape back into the centreline it
  // was built from rather than pattern-matching the path data.
  const bowed = await page.evaluate(() => {
    const d = document.querySelector('[data-edge-id]')!.getAttribute('d')!
    const pts = d
      .replace(/\s*Z$/, '')
      .split(/(?=[ML])/)
      .map((s) => s.trim().replace(/^[ML]\s*/, ''))
      .filter(Boolean)
      .map((s) => {
        const [x, y] = s.split(/\s+/).map(Number)
        return { x: x!, y: y! }
      })
    const n = pts.length / 2
    const centre = (i: number) => ({
      x: (pts[i]!.x + pts[pts.length - 1 - i]!.x) / 2,
      y: (pts[i]!.y + pts[pts.length - 1 - i]!.y) / 2,
    })
    const a = centre(0)
    const b = centre(n - 1)
    const chord = Math.hypot(b.x - a.x, b.y - a.y)
    let worst = 0
    for (let i = 0; i < n; i++) {
      const m = centre(i)
      const cross = (b.x - a.x) * (m.y - a.y) - (b.y - a.y) * (m.x - a.x)
      worst = Math.max(worst, Math.abs(cross) / chord)
    }
    return worst
  })
  expect(bowed).toBeLessThan(0.5)
})

// The style switch is board-wide: it restyles connectors that already exist,
// not just the next one drawn, and the choice survives a reload.
test('switching connector style restyles existing connectors', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 600)
  const bodies = page.getByTestId('text-node-body')
  await bodies.first().hover()
  await page.locator('[data-part="handle"][data-dir="e"]').first().click()
  await bodies.first().hover()
  await page.locator('[data-part="handle"][data-dir="s"]').first().click()

  const paths = page.locator('[data-edge-id]')
  await expect(paths).toHaveCount(2)
  for (const p of await paths.all()) await expect(p).toHaveAttribute('data-edge-style', 'curve')

  await page.getByTestId('edge-style').click()
  for (const p of await paths.all()) await expect(p).toHaveAttribute('data-edge-style', 'arrow')
  await page.getByTestId('edge-style').click()
  for (const p of await paths.all()) await expect(p).toHaveAttribute('data-edge-style', 'elbow')

  // Every edge was stored as 'curve', so 'elbow' on disk is the board setting.
  await waitForPersisted(page, 'default', 'elbow')
  await page.reload()
  await expect(page.getByTestId('edge-style')).toHaveAttribute('data-edge-style', 'elbow')
  await expect(paths).toHaveCount(2)
  for (const p of await paths.all()) await expect(p).toHaveAttribute('data-edge-style', 'elbow')
})

test('zooms about the viewport centre and reports the level', async ({ page }) => {
  await expect(page.getByTestId('zoom-level')).toHaveText('100%')
  await page.getByTestId('zoom-in').click()
  await expect(page.getByTestId('zoom-level')).toHaveText('120%')
})

test('deletes the selected node with the Delete key', async ({ page }) => {
  await page.getByTestId('add-text').click()
  // "+ Text" drops the new node straight into an edit session. Clicking empty
  // canvas ends it (and deselects); clicking the node then selects it without
  // reopening the editor. No Escape: the keyboard must return to command mode
  // on its own, which is exactly what this test now also proves.
  await page.mouse.click(600, 600)
  await page.getByTestId('text-node-body').first().click()
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('text-node-body')).toHaveCount(0)
})

// Regression: `editingId` used to be cleared only by Escape, so the very first
// node created put the board in "typing" mode permanently and the Delete
// branch was unreachable for the rest of the session.
test('Delete works after a text edit without pressing Escape', async ({ page }) => {
  await page.getByTestId('add-text').click()
  const body = page.getByTestId('text-node-body').first()
  await body.dblclick()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('typed then abandoned')
  await page.mouse.click(600, 600) // click away: this alone must end the edit
  await expect(body).toHaveText('typed then abandoned')

  await body.click() // re-select the node, still with no Escape anywhere
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('text-node-body')).toHaveCount(0)
})

// Regression: while the edit session never ended, TextNode kept rendering its
// frozen draft, so the document could be rolled back underneath a view that
// went on showing the edited text. The first ⌘Z looked like a no-op and the
// second deleted the node.
test('one undo after an edit shows the reverted text on screen', async ({ page }) => {
  await page.getByTestId('add-text').click()
  const body = page.getByTestId('text-node-body').first()
  // A new node is empty, showing "New idea" only as a placeholder.
  await expect(body).toHaveText('')
  await expect(body).toHaveAttribute('data-empty', 'true')

  await body.dblclick()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('edited text')
  await page.mouse.click(600, 600) // blur commits the edit
  await expect(body).toHaveText('edited text')

  await page.keyboard.press('ControlOrMeta+z')
  await expect(body).toHaveText('')
})

// Regression: the middle-button branch returned before setPointerCapture, so a
// release over the Toolbar (a sibling of the viewport, whose events never
// bubble to it) never reached the handler that ends the pan. The board then
// followed every subsequent bare mouse move with no button held.
test('a middle-drag released off the viewport does not leave the board panning', async ({
  page,
}) => {
  await page.getByTestId('add-text').click()
  await page.mouse.click(700, 600) // end the edit session
  const body = page.getByTestId('text-node-body').first()

  // Middle-drag the board, then release with the cursor over the toolbar.
  await page.mouse.move(400, 500)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(340, 440, { steps: 5 })
  await page.mouse.move(40, 30, { steps: 5 })
  await page.mouse.up({ button: 'middle' })

  const afterPan = await body.boundingBox()
  if (!afterPan) throw new Error('expected the node to be visible')

  // Bare moves, no button held: the board must not budge.
  await page.mouse.move(500, 500)
  await page.mouse.move(800, 300, { steps: 5 })

  const afterHover = await body.boundingBox()
  expect(afterHover).toEqual(afterPan)
})

test('pointercancel clears an in-flight marquee instead of leaving a ghost box', async ({ page }) => {
  // Start a marquee drag on empty canvas and leave it in flight (no pointerup).
  await page.mouse.move(300, 300)
  await page.mouse.down()
  await page.mouse.move(500, 450, { steps: 5 })
  await expect(page.getByTestId('marquee')).toBeVisible()

  // Simulate a touch/gesture interruption (a real device delivers
  // pointercancel instead of pointerup -- e.g. the browser's own gesture
  // recognizer taking over a two-finger scroll; per the Pointer Events spec,
  // no pointerup follows a pointercancel for that same interaction).
  // Playwright's mouse API has no "cancel" action, so dispatch the real
  // event directly.
  await page.evaluate(() => {
    const viewport = document.querySelector('[data-testid="viewport"]')
    viewport?.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }))
  })

  // The marquee box must be gone *immediately* on cancel, before any further
  // pointer event -- real or synthetic. This must be checked before calling
  // page.mouse.up() below: a real pointerup is what a completed (not
  // cancelled) drag would send, and selectTool.onUp *also* clears the
  // marquee via that normal path when marqueeOrigin is still set. Checking
  // after an up would pass whether or not the pointercancel listener ever
  // attached, which is exactly the "passes either way" trap to avoid here.
  // (selectTool.onDown separately resets module-level state defensively on
  // the *next* pointer-down regardless of this fix, so that alone also
  // wouldn't distinguish a working handler from one that never attached --
  // this in-flight, pre-next-gesture check is what actually does.)
  await expect(page.getByTestId('marquee')).toHaveCount(0)

  // Only now release Playwright's own virtual mouse button, purely so later
  // actions in this test behave normally. By this point the app has already
  // cleared marqueeOrigin on the cancel above, so this is a no-op for
  // gesture state -- selectTool.onUp's `if (marqueeOrigin)` branch sees null
  // and does nothing.
  await page.mouse.up()

  // The gesture system should be fully usable again: a fresh marquee-select
  // and delete on a new node works exactly as normal.
  await page.getByTestId('add-text').click()
  await page.waitForTimeout(100)
  const nodeBox = await page.getByTestId('text-node-body').first().boundingBox()
  if (!nodeBox) throw new Error('expected node to be visible')
  // Dragged from below-right: the node is open for editing, so its format bar
  // occupies the space just above it, and a press there belongs to the bar.
  await page.mouse.move(nodeBox.x + nodeBox.width + 20, nodeBox.y + nodeBox.height + 20)
  await page.mouse.down()
  await page.mouse.move(nodeBox.x - 20, nodeBox.y - 5, { steps: 5 })
  await page.mouse.up()
  // No Escape: the marquee's own pointer-down on empty canvas is what ends the
  // edit session "+ Text" opened, so the keyboard is already back in command
  // mode by the time Delete arrives.
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('text-node-body')).toHaveCount(0)
})

/** A root on screen with one child spawned to its east, both out of edit mode. */
async function rootAndChild(page: Page) {
  await page.getByTestId('add-text').click()
  await page.mouse.click(600, 650)
  await dragFromHandle(page, 0, 'e', { x: 900, y: 450 })
  await page.mouse.click(600, 650)
  await expect(page.getByTestId('text-node-body')).toHaveCount(2)
  await expect(page.locator('[data-edge-id]')).toHaveCount(1)
}

test('a connector follows its node while the node is being dragged', async ({ page }) => {
  await rootAndChild(page)
  const edge = page.locator('[data-edge-id]')
  const before = await edge.getAttribute('d')

  const child = await page.getByTestId('text-node-body').nth(1).boundingBox()
  if (!child) throw new Error('expected the child to be visible')
  await page.mouse.move(child.x + 30, child.y + child.height / 2)
  await page.mouse.down()
  await page.mouse.move(child.x + 30, child.y + 200, { steps: 8 })

  // Mid-gesture: nothing is committed yet, but the connector is already there.
  const during = await edge.getAttribute('d')
  expect(during).not.toBe(before)

  await page.mouse.up()
  // And releasing does not jump it: the committed shape is the one shown.
  await expect(edge).toHaveAttribute('d', during!)
})

test('clicking a node opens the colour wheel, and a swatch recolours its branch', async ({
  page,
}) => {
  await rootAndChild(page)
  await expect(page.getByTestId('color-wheel')).toHaveCount(0)

  await page.getByTestId('text-node-body').nth(1).click()
  await expect(page.getByTestId('color-wheel')).toBeVisible()
  await page.getByTestId('swatch-#3c9bd0').click()
  await expect(page.locator('[data-edge-id]')).toHaveAttribute('fill', '#3c9bd0')

  // A grandchild continues the colour chosen for its parent.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('color-wheel')).toHaveCount(0)
  await dragFromHandle(page, 1, 'e', { x: 1150, y: 450 })
  await page.mouse.click(600, 650)
  const fills = await page
    .locator('[data-edge-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('fill')))
  expect(fills).toEqual(['#3c9bd0', '#3c9bd0'])

  // Auto hands the branch back to the palette, and it is one undo step away.
  await page.getByTestId('text-node-body').nth(1).click()
  await page.getByTestId('swatch-auto').click()
  await expect(page.locator('[data-edge-id]').first()).not.toHaveAttribute('fill', '#3c9bd0')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('[data-edge-id]').first()).toHaveAttribute('fill', '#3c9bd0')
})

test('the format bar styles the node being edited without ending the edit', async ({ page }) => {
  await page.getByTestId('add-text').click()
  const body = page.getByTestId('text-node-body').first()
  await expect(page.getByTestId('format-bar')).toBeVisible()

  await page.getByTestId('preset-heading').click()
  await expect(body).toHaveCSS('font-size', '26px')
  await expect(body).toHaveCSS('font-weight', '700')
  await expect(page.getByTestId('preset-heading')).toHaveAttribute('aria-pressed', 'true')

  // Still editing: the click did not take focus, so typing still lands.
  await expect(body).toHaveAttribute('contenteditable', 'true')
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('Big idea')
  await page.keyboard.press('ControlOrMeta+i')
  await expect(body).toHaveCSS('font-style', 'italic')

  await page.getByTestId('size-up').click()
  await expect(body).toHaveCSS('font-size', '32px')

  await page.mouse.click(600, 650)
  await expect(page.getByTestId('format-bar')).toHaveCount(0)
  await expect(body).toHaveText('Big idea')
  await expect(body).toHaveCSS('font-style', 'italic')
})

test('a node can drop its box, shrink to its text, and get the box back', async ({ page }) => {
  await page.getByTestId('add-text').click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('Hi')
  const outer = page.locator('[data-node-id]').first()
  const boxed = (await outer.boundingBox())!

  await page.getByTestId('toggle-box').click()
  await page.mouse.click(600, 650)

  await expect(outer).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  // Shrunk to the text, about the same centre.
  await expect.poll(async () => (await outer.boundingBox())!.width).toBeLessThan(100)
  const bare = (await outer.boundingBox())!
  expect(Math.abs(bare.x + bare.width / 2 - (boxed.x + boxed.width / 2))).toBeLessThan(2)

  // The text was committed after the toggle, so the first undo takes back the
  // text and the second brings the card back — full width, centred where it was.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByTestId('text-node-body')).toHaveText('')
  await expect(outer).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await outer.boundingBox())!.width).toBeCloseTo(boxed.width, 0)
  await expect(outer).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  const back = (await outer.boundingBox())!
  expect(Math.abs(back.x - boxed.x)).toBeLessThan(2)
})
