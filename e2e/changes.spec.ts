import { expect, test, type Page } from '@playwright/test'
import { waitForPersisted } from './persisted'

test.beforeEach(async ({ page }) => {
  // Straight into the board every install starts with; `/` is the home screen.
  await page.goto('/#/b/default')
  await page.evaluate(async () => {
    for (const db of await indexedDB.databases()) if (db.name) indexedDB.deleteDatabase(db.name)
  })
  await page.reload()
  await expect(page.getByTestId('toolbar')).toBeVisible()
})

const bodies = (page: Page) => page.getByTestId('text-node-body')
const edges = (page: Page) => page.locator('[data-edge-id]')

/** Clicks one of node `i`'s spawn handles, then clicks away to end the edit. */
async function spawn(page: Page, i: number, dir: 'n' | 'e' | 's' | 'w') {
  await bodies(page).nth(i).hover()
  await page.locator(`[data-part="handle"][data-dir="${dir}"]`).nth(i).click()
  await page.mouse.click(1200, 680)
}

/** A root node in the middle of the board, out of the edit session. */
async function root(page: Page) {
  await page.mouse.dblclick(640, 380)
  await page.mouse.move(580, 380, { steps: 4 })
  await page.mouse.click(1200, 680)
}

const fills = (page: Page) =>
  page.$$eval('[data-edge-id]', (els) => els.map((el) => el.getAttribute('fill')))

test('typing into a new node replaces the prompt rather than adding to it', async ({ page }) => {
  await page.getByTestId('add-text').click()
  const body = bodies(page).first()
  await expect(body).toHaveAttribute('data-empty', 'true')
  await page.keyboard.type('hello')
  await expect(body).toHaveText('hello')
  await expect(body).not.toHaveAttribute('data-empty', 'true')
  await page.mouse.click(1200, 680)
  await expect(body).toHaveText('hello')
})

test('linking a child back into a hub does not repaint the hub`s branches', async ({ page }) => {
  await root(page)
  await spawn(page, 0, 'n')
  await spawn(page, 0, 'w')
  await spawn(page, 0, 'e')
  await expect(edges(page)).toHaveCount(3)
  const before = await fills(page)
  expect(new Set(before).size).toBe(3)

  // Drag from the north child's handle back onto the hub.
  const hub = (await bodies(page).first().boundingBox())!
  await bodies(page).nth(1).hover()
  await page.locator('[data-part="handle"][data-dir="e"]').nth(1).hover()
  await page.mouse.down()
  await page.mouse.move(hub.x + hub.width - 20, hub.y + hub.height / 2, { steps: 10 })
  await page.mouse.up()

  await expect(edges(page)).toHaveCount(4)
  expect((await fills(page)).slice(0, 3)).toEqual(before)
})

test('a node is drawn in the colour of the link that leads to it', async ({ page }) => {
  await root(page)
  await spawn(page, 0, 'e')
  const fill = await edges(page).first().getAttribute('fill')
  const child = page.locator('[data-node-id]').nth(1)
  const rgb = await page.evaluate((hex) => {
    const n = parseInt(hex!.slice(1), 16)
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
  }, fill)
  await expect(child).toHaveCSS('border-top-color', rgb)
  // The hub, with branches of several colours, stays ink.
  await expect(page.locator('[data-node-id]').first()).toHaveCSS('border-top-color', 'rgb(26, 26, 26)')
})

test('a link can be clicked, recoloured and deleted on its own', async ({ page }) => {
  await root(page)
  await spawn(page, 0, 'e')
  await spawn(page, 0, 'w')
  await expect(edges(page)).toHaveCount(2)

  const path = edges(page).first()
  const box = (await path.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByTestId('edge-delete')).toBeVisible()
  await expect(path).toHaveAttribute('data-selected', 'true')

  await page.getByTestId('swatch-#3c9bd0').click()
  await expect(path).toHaveAttribute('fill', '#3c9bd0')

  await page.getByTestId('edge-delete').click()
  await expect(edges(page)).toHaveCount(1)
  // Both nodes survive: only the link went.
  await expect(bodies(page)).toHaveCount(3)

  // And it is one undo step back.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(edges(page)).toHaveCount(2)
})

test('the arrow style draws links with a head', async ({ page }) => {
  await root(page)
  await page.getByTestId('edge-style').click()
  await expect(page.getByTestId('edge-style')).toHaveText('Arrow')
  await spawn(page, 0, 'e')
  await expect(edges(page).first()).toHaveAttribute('data-edge-style', 'arrow')
})

test('Fit centres everything in the view', async ({ page }) => {
  await root(page)
  await spawn(page, 0, 'e')
  // Wander off: zoom in hard and pan away.
  for (let i = 0; i < 4; i++) await page.getByTestId('zoom-in').click()
  await page.mouse.move(640, 400)
  await page.mouse.wheel(900, 600)

  await page.getByTestId('fit-view').click()
  await page.waitForTimeout(400)
  const boxes = await page.locator('[data-node-id]').evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom })),
  )
  const l = Math.min(...boxes.map((b) => b.l))
  const r = Math.max(...boxes.map((b) => b.r))
  const t = Math.min(...boxes.map((b) => b.t))
  const b = Math.max(...boxes.map((b) => b.b))
  const vp = page.viewportSize()!
  expect(Math.abs((l + r) / 2 - vp.width / 2)).toBeLessThan(2)
  expect(Math.abs((t + b) / 2 - vp.height / 2)).toBeLessThan(2)
})

/**
 * Hands files to the board's media file input. The files are made in the
 * page — a real PNG drawn on a canvas, or plain bytes — and handed to the
 * input the way the browser's file picker would.
 */
async function pick(page: Page, file: { name: string; type: string; png?: [number, number]; text?: string }) {
  await page.evaluate(async (f) => {
    let blob: Blob
    if (f.png) {
      const c = document.createElement('canvas')
      ;[c.width, c.height] = f.png
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#5b7fc4'
      ctx.fillRect(0, 0, c.width, c.height)
      blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))
    } else {
      blob = new Blob([f.text ?? ''], { type: f.type })
    }
    const dt = new DataTransfer()
    dt.items.add(new File([blob], f.name, { type: f.type }))
    const input = document.querySelector<HTMLInputElement>('[data-testid="media-input"]')!
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, file)
}

test('an image can be added, keeps its proportions, and survives a reload', async ({ page }) => {
  await pick(page, { name: 'wide.png', type: 'image/png', png: [400, 200] })
  const img = page.locator('[data-testid="image-node"] img')
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(400)
  const node = page.locator('[data-node-id]').first()
  const box = (await node.boundingBox())!
  expect(box.width / box.height).toBeCloseTo(2, 1)

  // Persisted: the file comes back from the media store after a reload.
  await page.waitForTimeout(500)
  await page.reload()
  await expect(page.locator('[data-testid="image-node"] img')).toBeVisible()
  await expect
    .poll(() => page.locator('[data-testid="image-node"] img').evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBe(400)
})

test('an image can be linked like any other node and resized from its corner', async ({ page }) => {
  await pick(page, { name: 'pic.png', type: 'image/png', png: [300, 300] })
  const node = page.locator('[data-node-id]').first()
  await expect(page.locator('[data-testid="image-node"] img')).toBeVisible()
  const before = (await node.boundingBox())!

  await node.hover()
  const grip = page.locator('[data-part="resize"]').first()
  await grip.hover()
  await page.mouse.down()
  await page.mouse.move(before.x + before.width + 80, before.y + before.height + 10, { steps: 8 })
  await page.mouse.up()
  const after = (await node.boundingBox())!
  expect(after.width).toBeGreaterThan(before.width + 50)
  // Square stays square.
  expect(after.width / after.height).toBeCloseTo(1, 1)

  await node.hover()
  await page.locator('[data-part="handle"][data-dir="e"]').first().click()
  await expect(edges(page)).toHaveCount(1)
})

test('a file type that cannot be shown is refused with a message', async ({ page }) => {
  await pick(page, { name: 'notes.zip', type: 'application/zip', text: 'PK' })
  await expect(page.getByTestId('notice')).toBeVisible()
  await expect(page.locator('[data-node-id]')).toHaveCount(0)
})

test('exports the board as PNG, JPEG and PDF', async ({ page }) => {
  await root(page)
  await spawn(page, 0, 'e')

  for (const [format, ext, magic] of [
    ['png', '.png', [0x89, 0x50, 0x4e, 0x47]],
    ['jpeg', '.jpg', [0xff, 0xd8, 0xff]],
    ['pdf', '.pdf', [0x25, 0x50, 0x44, 0x46]],
  ] as const) {
    await page.getByTestId('export').click()
    await page.getByTestId(`export-format-${format}`).click()
    await page.getByTestId('export-pattern-grid').click()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-go').click()])
    expect(download.suggestedFilename().endsWith(ext)).toBe(true)
    const head: number[] = []
    for await (const chunk of await download.createReadStream()) {
      head.push(...(chunk as Uint8Array))
      if (head.length >= magic.length) break
    }
    expect(head.slice(0, magic.length)).toEqual([...magic])
    await expect(page.getByTestId('export-dialog')).toHaveCount(0)
  }
})

test('double-clicking empty canvas offers Text and Media; a swipe right opens the file chooser', async ({
  page,
}) => {
  await page.mouse.dblclick(640, 380)
  await expect(page.getByTestId('create-picker')).toBeVisible()
  // No button for media any more: the picker is the way in.
  await expect(page.getByTestId('add-media')).toHaveCount(0)

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.mouse.move(700, 380, { steps: 4 }),
  ])
  await expect(page.getByTestId('create-picker')).toHaveCount(0)
  expect(chooser.isMultiple()).toBe(true)
})

test('media picked from the picker lands where the double-click was', async ({ page }) => {
  await page.mouse.dblclick(400, 300)
  await page.mouse.move(460, 300, { steps: 4 })
  await pick(page, { name: 'here.png', type: 'image/png', png: [200, 200] })
  const box = (await page.locator('[data-node-id]').first().boundingBox())!
  expect(Math.abs(box.x + box.width / 2 - 400)).toBeLessThan(3)
  expect(Math.abs(box.y + box.height / 2 - 300)).toBeLessThan(3)
})

test('Esc closes the picker without adding anything', async ({ page }) => {
  await page.mouse.dblclick(640, 380)
  await expect(page.getByTestId('create-picker')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('create-picker')).toHaveCount(0)
  await expect(page.locator('[data-node-id]')).toHaveCount(0)
})

test('media sits on the board with no frame round it', async ({ page }) => {
  await pick(page, { name: 'bare.png', type: 'image/png', png: [300, 200] })
  const node = page.locator('[data-node-id]').first()
  await expect(page.locator('[data-testid="image-node"] img')).toBeVisible()
  await expect(node).toHaveCSS('border-top-width', '0px')
  await expect(node).toHaveCSS('box-shadow', 'none')
  await expect(node).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  // The picture fills the node edge to edge.
  const img = (await page.locator('[data-testid="image-node"] img').boundingBox())!
  const box = (await node.boundingBox())!
  expect(Math.abs(img.width - box.width)).toBeLessThan(1)
  expect(Math.abs(img.height - box.height)).toBeLessThan(1)
})

test('a board opens fitted to its content, even far from where a view starts', async ({ page }) => {
  // Build far from the origin, where a fresh view would open.
  await page.mouse.move(640, 400)
  await page.mouse.wheel(4000, 3000)
  await root(page)
  await spawn(page, 0, 'e')
  // Node ids are strings in the stored update, so the newest one on disk means both are.
  const last = await page.locator('[data-node-id]').nth(1).getAttribute('data-node-id')
  await waitForPersisted(page, 'default', last!)

  await page.reload()
  await expect(page.locator('[data-node-id]')).toHaveCount(2)
  const view = page.viewportSize()!
  for (const box of await page.locator('[data-node-id]').evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect),
  )) {
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.top).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(view.width)
    expect(box.bottom).toBeLessThanOrEqual(view.height)
  }
})
