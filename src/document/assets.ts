import type { AssetId } from '../types'

/**
 * Where the bytes of media files live: an IndexedDB object store of Blobs,
 * keyed by asset id, separate from the board's Yjs document.
 *
 * Not in the document because a Yjs update log is replayed in full on every
 * load and never compacts a deleted value away — one 40 MB video would make
 * the board slow to open forever, even after the node was deleted. The
 * document holds only the id and the metadata a view needs to lay itself out
 * (see media/ingest.ts); the bytes are fetched on demand.
 *
 * Blobs are never deleted when their node is, because undo can bring the node
 * back and it must find its file still there.
 */
const DB_NAME = 'brainstorm-canvas-assets'
const STORE = 'blobs'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        dbPromise = null
        reject(req.error ?? new Error('Could not open the media store.'))
      }
    })
  }
  return dbPromise
}

/**
 * Where asset bytes are kept. IndexedDB here; R2 behind the Worker in the cloud
 * backend (account/cloud/cloudAssets.ts). Chosen once at startup (see account/types.ts `Backend`).
 */
export type AssetBackend = {
  put(id: AssetId, blob: Blob): Promise<void>
  get(id: AssetId): Promise<Blob | null>
}

async function idbPut(id: AssetId, blob: Blob): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Could not save the file.'))
    tx.onabort = () => reject(tx.error ?? new Error('Saving the file was aborted.'))
  })
}

async function idbGet(id: AssetId): Promise<Blob | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null)
    req.onerror = () => reject(req.error ?? new Error('Could not read the file.'))
  })
}

export const indexedDbAssets: AssetBackend = { put: idbPut, get: idbGet }

let backend: AssetBackend = indexedDbAssets
const urls = new Map<AssetId, Promise<string | null>>()

/** Points every asset read and write at `next`. Called before any board opens. */
export function setAssetBackend(next: AssetBackend): void {
  backend = next
  urls.clear()
}

export const putAssetBlob = (id: AssetId, blob: Blob): Promise<void> => backend.put(id, blob)
export const getAssetBlob = (id: AssetId): Promise<Blob | null> => backend.get(id)

/**
 * An object URL for an asset's bytes, created once per asset per page load
 * and shared by every view of it (and by export). Resolves to null when the
 * bytes are missing — a board copied without its media store, say.
 */
export function assetUrl(id: AssetId): Promise<string | null> {
  let p = urls.get(id)
  if (!p) {
    p = getAssetBlob(id).then(
      (blob) => (blob ? URL.createObjectURL(blob) : null),
      () => null,
    )
    urls.set(id, p)
  }
  return p
}

/** Seeds the URL cache for an asset just ingested, so it shows without a read back. */
export function primeAssetUrl(id: AssetId, blob: Blob): void {
  urls.set(id, Promise.resolve(URL.createObjectURL(blob)))
}
