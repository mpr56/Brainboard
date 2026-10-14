import { expect, test, type Page } from '@playwright/test'

// Runs only against the cloud backend: `npm run dev:cloud` in one terminal,
// then `npx playwright test e2e/cloud.spec.ts`. On the local backend there is
// no API — /api/boards is just the app's HTML — so the test skips itself.
test.beforeEach(async ({ request }) => {
  const res = await request.get('/api/boards')
  test.skip(res.status() !== 401, 'cloud backend only (npm run dev:cloud)')
})

const boardIdOf = (page: Page) => new URL(page.url()).hash.replace('#/b/', '')

async function wipeBrowser(page: Page) {
  await page.evaluate(async () => {
    for (const db of await indexedDB.databases()) if (db.name) indexedDB.deleteDatabase(db.name)
  })
}

test('a board and its media live on the server, survive a wiped browser, and edit offline', async ({ page, context }) => {
  await page.goto('/')
  await wipeBrowser(page)
  await context.clearCookies()
  await page.reload()
  await expect(page.getByTestId('home')).toBeVisible()
  await expect(page.getByTestId('sign-in-google')).toBeVisible()

  await page.getByTestId('home-new').click()
  await expect(page.getByTestId('toolbar')).toBeVisible()
  await page.getByTestId('board-title-input').fill('Cloud smoke')
  await page.getByTestId('board-title-input').press('Enter')
  const id = boardIdOf(page)

  await page.getByTestId('add-text').click()
  await page.keyboard.type('stored remotely')
  await page.mouse.click(600, 600)
  await page.getByTestId('media-input').setInputFiles('e2e/fixtures/dot.png')
  await expect(page.locator('img')).toHaveCount(1)

  // Let the room's debounced save run (2 s, at most 10 s) and the upload finish.
  await page.waitForTimeout(3000)

  // Nothing local left: contents must come back from the server.
  await page.goto('/')
  await wipeBrowser(page)
  await page.goto(`/#/b/${id}`)
  await expect(page.getByText('stored remotely')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('img')).toHaveCount(1)
  expect(await page.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)

  // Offline: the note appears, editing still works, and it clears on reconnect.
  await context.setOffline(true)
  await expect(page.getByTestId('sync-offline')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('add-text').click()
  await page.keyboard.type('made offline')
  await page.mouse.click(600, 650)
  await context.setOffline(false)
  await expect(page.getByTestId('sync-offline')).toBeHidden({ timeout: 15_000 })
  await page.waitForTimeout(3000)

  await page.goto('/')
  await wipeBrowser(page)
  await page.goto(`/#/b/${id}`)
  await expect(page.getByText('made offline')).toBeVisible({ timeout: 10_000 })
})
