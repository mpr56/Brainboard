import { indexedDbAssets, type AssetBackend } from '../../document/assets'
import type { AssetId } from '../../types'
import { ApiError, api } from './api'

/** The Worker's ceiling (100 MB request bodies on the free plan), with headroom. */
export const ASSET_MAX_BYTES = 95 * 1024 * 1024
const PENDING_KEY = 'bb_pending_uploads'

export type CloudAssets = AssetBackend & {
  /** Uploads anything a previous put could not. Stops at the first failure; the rest wait for next time. */
  retryPending(): Promise<void>
}

/**
 * Media in R2, with this browser's IndexedDB store in front of it: writes land
 * locally first (so the node shows at once, and offline), reads come from the
 * local copy when there is one. A failed upload is remembered and retried on
 * the next start, so a file is never only on a server that never got it.
 */
export function createCloudAssets(cache: AssetBackend = indexedDbAssets, storage: Storage = localStorage): CloudAssets {
  const pending = (): Set<AssetId> => {
    try {
      return new Set(JSON.parse(storage.getItem(PENDING_KEY) ?? '[]') as AssetId[])
    } catch {
      return new Set()
    }
  }
  const mark = (id: AssetId, waiting: boolean) => {
    const ids = pending()
    if (waiting) ids.add(id)
    else ids.delete(id)
    storage.setItem(PENDING_KEY, JSON.stringify([...ids]))
  }

  const upload = (id: AssetId, blob: Blob) =>
    api(`/api/assets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    })

  return {
    async put(id, blob) {
      if (blob.size > ASSET_MAX_BYTES) throw new Error('That file is too large to upload — the limit is 95 MB.')
      await cache.put(id, blob)
      try {
        await upload(id, blob)
      } catch {
        mark(id, true)
      }
    },

    async get(id) {
      const local = await cache.get(id)
      if (local) return local
      let res: Response
      try {
        res = await api(`/api/assets/${encodeURIComponent(id)}`)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
      const blob = await res.blob()
      await cache.put(id, blob).catch(() => {})
      return blob
    },

    async retryPending() {
      for (const id of pending()) {
        const blob = await cache.get(id)
        if (!blob) {
          mark(id, false)
          continue
        }
        try {
          await upload(id, blob)
          mark(id, false)
        } catch {
          return
        }
      }
    },
  }
}
