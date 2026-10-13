/**
 * The IndexedDB database behind the local backend: the user registry and the
 * board registry. Board contents are not here — each board is its own
 * y-indexeddb database (see document/persistence.ts).
 */
export const ACCOUNTS_DB = 'brainstorm-canvas-accounts'

export const USERS = 'users'
export const BOARDS = 'boards'
/** Odd flags the local backend needs to remember, keyed by name. */
export const META = 'meta'

export type OpenDb = () => Promise<IDBDatabase>

/** Opens the database once, on first use, and hands back the same connection after. */
export function localDb(name = ACCOUNTS_DB): OpenDb {
  let db: Promise<IDBDatabase> | null = null
  return () => {
    if (!db) {
      db = new Promise((resolve, reject) => {
        const req = indexedDB.open(name, 1)
        req.onupgradeneeded = () => {
          const d = req.result
          d.createObjectStore(USERS, { keyPath: 'id' })
          d.createObjectStore(BOARDS, { keyPath: 'id' }).createIndex('ownerId', 'ownerId')
          d.createObjectStore(META)
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => {
          db = null
          reject(req.error ?? new Error('Could not open the account store.'))
        }
      })
    }
    return db
  }
}

/** Settles with a request's result. */
export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('An account store request failed.'))
  })
}

export async function getOne<T>(open: OpenDb, store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await open()
  return request(db.transaction(store, 'readonly').objectStore(store).get(key)) as Promise<T | undefined>
}

export async function getAll<T>(open: OpenDb, store: string): Promise<T[]> {
  const db = await open()
  return request(db.transaction(store, 'readonly').objectStore(store).getAll()) as Promise<T[]>
}

export async function getAllByIndex<T>(
  open: OpenDb,
  store: string,
  index: string,
  key: IDBValidKey,
): Promise<T[]> {
  const db = await open()
  return request(db.transaction(store, 'readonly').objectStore(store).index(index).getAll(key)) as Promise<
    T[]
  >
}

/** Writes in one transaction, resolving once it has committed. */
export async function write(
  open: OpenDb,
  store: string,
  fn: (s: IDBObjectStore) => void,
): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    fn(tx.objectStore(store))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Could not save to the account store.'))
    tx.onabort = () => reject(tx.error ?? new Error('Saving to the account store was aborted.'))
  })
}
