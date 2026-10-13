import { expect, test, type Page } from '@playwright/test'
import { waitForPersisted } from './persisted'

test.beforeEach(async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    for (const db of await indexedDB.databases()) if (db.name) indexedDB.deleteDatabase(db.name)
  })
  await context.clearCookies()
  await page.reload()
  await expect(page.getByTestId('toolbar')).toBeVisible()
})

const toggle = (page: Page) => page.getByTestId('board-menu-toggle')
const row = (page: Page, title: string) => page.getByTestId('board-row').filter({ hasText: title })

async function currentBoardId(page: Page): Promise<string> {
  return (await toggle(page).getAttribute('data-board-id'))!
}

/** Adds a text node holding `text` and waits for it to reach disk. */
async function addText(page: Page, text: string) {
  await page.getByTestId('add-text').click()
  await page.keyboard.type(text)
  await page.mouse.click(600, 600)
  await waitForPersisted(page, await currentBoardId(page), text)
}

async function newBoard(page: Page, title: string) {
  await toggle(page).click()
  await page.getByTestId('board-new').click()
  const input = page.getByTestId('board-rename-input')
  await input.fill(title)
  await input.press('Enter')
  await expect(toggle(page)).toContainText(title)
}

async function openBoard(page: Page, title: string) {
  await toggle(page).click()
  await row(page, title).getByTestId('board-open').click()
  await expect(toggle(page)).toContainText(title)
}

test('a first visit is an anonymous session, remembered in a cookie', async ({ page, context }) => {
  const cookie = (await context.cookies()).find((c) => c.name === 'bb_session')
  expect(cookie?.value).toMatch(/^[0-9a-f-]{36}$/)
  expect(cookie?.sameSite).toBe('Lax')
  // The pre-accounts board is adopted as the first board.
  expect(await currentBoardId(page)).toBe('default')
})

test('each board keeps its own content', async ({ page }) => {
  await addText(page, 'first board idea')
  await newBoard(page, 'Second')
  await expect(page.getByText('first board idea')).toHaveCount(0)
  await addText(page, 'second board idea')

  await openBoard(page, 'Untitled board')
  await expect(page.getByText('first board idea')).toBeVisible()
  await expect(page.getByText('second board idea')).toHaveCount(0)

  await page.reload()
  await openBoard(page, 'Second')
  await expect(page.getByText('second board idea')).toBeVisible()
})

test('boards survive losing the session cookie', async ({ page, context }) => {
  // Safari expires script-set cookies after seven days; the boards must not go with it.
  await newBoard(page, 'Kept')
  const before = (await context.cookies()).find((c) => c.name === 'bb_session')!.value
  await context.clearCookies()
  await page.reload()
  await toggle(page).click()
  await expect(row(page, 'Kept')).toBeVisible()
  expect((await context.cookies()).find((c) => c.name === 'bb_session')?.value).toBe(before)
})

test('renames and deletes boards', async ({ page }) => {
  await newBoard(page, 'Doomed')
  const doomedId = await currentBoardId(page)
  await toggle(page).click()
  await row(page, 'Untitled board').getByTestId('board-rename').click()
  await page.getByTestId('board-rename-input').fill('Main')
  await page.getByTestId('board-rename-input').press('Enter')
  await expect(row(page, 'Main')).toBeVisible()

  await row(page, 'Doomed').getByTestId('board-delete').click()
  await page.getByTestId('board-delete-confirm').click()
  await expect(row(page, 'Doomed')).toHaveCount(0)
  // The open board was the one deleted, so the remaining one is now open.
  await expect(toggle(page)).toContainText('Main')
  // Its contents go with it, once the board has closed.
  await page.waitForFunction(
    async (name) => !(await indexedDB.databases()).some((d) => d.name === name),
    `brainstorm-canvas/${doomedId}`,
  )

  await page.reload()
  await toggle(page).click()
  await expect(page.getByTestId('board-row')).toHaveCount(1)
  await expect(row(page, 'Main')).toBeVisible()
})

test('typing a board title does not edit the board behind it', async ({ page }) => {
  await addText(page, 'keep me')
  await page.getByText('keep me').click() // select it
  await toggle(page).click()
  await row(page, 'Untitled board').getByTestId('board-rename').click()
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Escape')
  await expect(page.getByText('keep me')).toBeVisible()
})

test('a board from before accounts is adopted with its content', async ({ page, context }) => {
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
  await page.reload()
  await expect(page.getByText('from before accounts')).toBeVisible()
  expect(await currentBoardId(page)).toBe('default')
})
