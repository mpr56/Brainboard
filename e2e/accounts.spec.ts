import { expect, test, type Page } from '@playwright/test'
import { waitForPersisted } from './persisted'

test.beforeEach(async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    for (const db of await indexedDB.databases()) if (db.name) indexedDB.deleteDatabase(db.name)
  })
  await context.clearCookies()
  await page.reload()
  await expect(page.getByTestId('home')).toBeVisible()
})

const card = (page: Page, title: string) => page.getByTestId('board-card').filter({ hasText: title })
const boardIdOf = (page: Page) => new URL(page.url()).hash.replace('#/b/', '')

/** Adds a text node holding `text` and waits for it to reach disk. */
async function addText(page: Page, text: string) {
  await page.getByTestId('add-text').click()
  await page.keyboard.type(text)
  await page.mouse.click(600, 600)
  await waitForPersisted(page, boardIdOf(page), text)
}

/** "+ New board" on home, named as it opens. */
async function newBoard(page: Page, title: string) {
  await page.getByTestId('home-new').click()
  await expect(page.getByTestId('toolbar')).toBeVisible()
  const input = page.getByTestId('board-title-input')
  await input.fill(title)
  await input.press('Enter')
  await expect(page.getByTestId('board-title')).toContainText(title)
}

const goHome = async (page: Page) => {
  await page.getByTestId('board-home').click()
  await expect(page.getByTestId('home')).toBeVisible()
}

test('a first visit lands on home, with an anonymous session in a cookie', async ({ page, context }) => {
  const cookie = (await context.cookies()).find((c) => c.name === 'bb_session')
  expect(cookie?.value).toMatch(/^[0-9a-f-]{36}$/)
  expect(cookie?.sameSite).toBe('Lax')
  // The pre-accounts board is adopted as the first board.
  await expect(page.getByTestId('board-card')).toHaveCount(1)
  await expect(page.getByTestId('board-card').first()).toHaveAttribute('data-board-id', 'default')
})

test('a card opens its board; Back and the header both return home', async ({ page }) => {
  await card(page, 'Untitled board').getByTestId('board-card-open').click()
  await expect(page).toHaveURL(/#\/b\/default$/)
  await expect(page.getByTestId('board-title')).toContainText('Untitled board')
  await expect(page).toHaveTitle('Untitled board · brainstorm')

  await page.goBack()
  await expect(page.getByTestId('home')).toBeVisible()
  await page.goForward()
  await expect(page.getByTestId('toolbar')).toBeVisible()
  await goHome(page)
  await expect(page).toHaveTitle('Boards · brainstorm')
})

test('reloading inside a board stays on it', async ({ page }) => {
  await newBoard(page, 'Stay')
  await addText(page, 'still here')
  await page.reload()
  await expect(page.getByText('still here')).toBeVisible()
  await expect(page.getByTestId('board-title')).toContainText('Stay')
})

test('each board keeps its own content', async ({ page }) => {
  await newBoard(page, 'First')
  await addText(page, 'first idea')
  await goHome(page)
  await newBoard(page, 'Second')
  await expect(page.getByText('first idea')).toHaveCount(0)
  await addText(page, 'second idea')
  await goHome(page)
  await card(page, 'First').getByTestId('board-card-open').click()
  await expect(page.getByText('first idea')).toBeVisible()
  await expect(page.getByText('second idea')).toHaveCount(0)
})

test('home shows a picture and counts of a board after leaving it', async ({ page }) => {
  await newBoard(page, 'Pictured')
  await addText(page, 'one')
  await addText(page, 'two')
  await goHome(page)
  const c = card(page, 'Pictured')
  await expect(c.getByTestId('board-thumb')).toBeVisible()
  await expect(c.getByTestId('board-card-meta')).toContainText('0 ▶ · 2 ▭')
  // And it is still there after a reload.
  await page.reload()
  await expect(card(page, 'Pictured').getByTestId('board-thumb')).toBeVisible()
})

test('most recently opened boards come first, and search filters by title', async ({ page }) => {
  await newBoard(page, 'Older')
  await goHome(page)
  await newBoard(page, 'Newer')
  await goHome(page)
  const titles = page.getByTestId('board-card-title')
  await expect(titles).toHaveText(['Newer', 'Older', 'Untitled board'])
  await page.getByTestId('home-search').fill('old')
  await expect(titles).toHaveText(['Older'])
})

test('renames and deletes boards from home', async ({ page }) => {
  await newBoard(page, 'Doomed')
  const doomedId = boardIdOf(page)
  await goHome(page)
  await card(page, 'Untitled board').getByTestId('board-rename').click()
  await page.getByTestId('board-rename-input').fill('Main')
  await page.getByTestId('board-rename-input').press('Enter')
  await expect(card(page, 'Main')).toBeVisible()

  await card(page, 'Doomed').getByTestId('board-delete').click()
  await page.getByTestId('board-delete-confirm').click()
  await expect(card(page, 'Doomed')).toHaveCount(0)
  // Its contents go with it.
  await page.waitForFunction(
    async (name) => !(await indexedDB.databases()).some((d) => d.name === name),
    `brainstorm-canvas/${doomedId}`,
  )

  await page.reload()
  await expect(page.getByTestId('board-card')).toHaveCount(1)
  await expect(card(page, 'Main')).toBeVisible()
  // A link to the deleted board leads home.
  await page.goto(`/#/b/${doomedId}`)
  await expect(page.getByTestId('home')).toBeVisible()
  await expect(page).toHaveURL(/#\/$/)
})

test('files dropped on home start a board holding them', async ({ page }) => {
  const dataTransfer = await page.evaluateHandle(async () => {
    // A 1×1 PNG.
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
      (c) => c.charCodeAt(0),
    )
    const dt = new DataTransfer()
    dt.items.add(new File([png], 'dot.png', { type: 'image/png' }))
    return dt
  })
  await page.getByTestId('home-drop').dispatchEvent('drop', { dataTransfer })
  await expect(page.getByTestId('toolbar')).toBeVisible()
  await expect(page.getByTestId('image-node')).toBeVisible()
})

test('boards survive losing the session cookie', async ({ page, context }) => {
  // Safari expires script-set cookies after seven days; the boards must not go with it.
  await newBoard(page, 'Kept')
  await goHome(page)
  const before = (await context.cookies()).find((c) => c.name === 'bb_session')!.value
  await context.clearCookies()
  await page.reload()
  await expect(card(page, 'Kept')).toBeVisible()
  expect((await context.cookies()).find((c) => c.name === 'bb_session')?.value).toBe(before)
})

test('typing a board title does not edit the board behind it', async ({ page }) => {
  await card(page, 'Untitled board').getByTestId('board-card-open').click()
  await addText(page, 'keep me')
  await page.getByText('keep me').click() // select it
  await page.getByTestId('board-title').click()
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Escape')
  await expect(page.getByText('keep me')).toBeVisible()
})

test('a board from before accounts is adopted with its content', async ({ page, context }) => {
  await card(page, 'Untitled board').getByTestId('board-card-open').click()
  await addText(page, 'from before accounts')
  // Back to how a pre-accounts install looks: the board's database, and nothing else.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('brainstorm-canvas-accounts')
        req.onsuccess = req.onerror = req.onblocked = () => resolve()
      }),
  )
  await context.clearCookies()
  await page.goto('/')
  await page.reload()
  await card(page, 'Untitled board').getByTestId('board-card-open').click()
  await expect(page.getByText('from before accounts')).toBeVisible()
})
