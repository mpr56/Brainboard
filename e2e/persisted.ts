import type { Page } from '@playwright/test'

/**
 * Waits for a real persisted signal instead of a blind constant: polls the
 * board's IndexedDB database from inside the page until the committed text is
 * actually present in a stored Yjs update.
 *
 * y-indexeddb keeps the document as binary update records in the `updates`
 * object store of `brainstorm-canvas/<boardId>`. Yjs encodes string content as
 * UTF-8 inside those records, so the text's bytes appearing there means the
 * write transaction has committed to disk — which is exactly the condition
 * DoD 8 ("close and reopen the browser and find the board as it was") depends
 * on, and the condition the old `waitForTimeout(300)` was guessing at.
 */
export async function waitForPersisted(page: Page, boardId: string, text: string) {
  await page.waitForFunction(
    async ([dbName, needle]: [string, string]) => {
      // Never open by name blindly: opening a database that does not exist
      // creates an empty one, which would race the app's own upgrade.
      const listed = await indexedDB.databases()
      if (!listed.some((d) => d.name === dbName)) return false

      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
        req.onblocked = () => resolve(null)
      })
      if (!db) return false
      try {
        if (!db.objectStoreNames.contains('updates')) return false
        const rows: unknown[] = await new Promise((resolve) => {
          const req = db.transaction('updates', 'readonly').objectStore('updates').getAll()
          req.onsuccess = () => resolve(req.result as unknown[])
          req.onerror = () => resolve([])
        })
        const decoder = new TextDecoder()
        return rows.some((row) => {
          const bytes =
            row instanceof Uint8Array
              ? row
              : row instanceof ArrayBuffer
                ? new Uint8Array(row)
                : null
          return bytes ? decoder.decode(bytes).includes(needle) : false
        })
      } finally {
        db.close()
      }
    },
    [`brainstorm-canvas/${boardId}`, text] as [string, string],
    { timeout: 15_000 },
  )
}
