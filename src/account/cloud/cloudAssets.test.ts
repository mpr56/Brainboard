import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssetBackend } from '../../document/assets'
import { ASSET_MAX_BYTES, createCloudAssets } from './cloudAssets'

const fetchMock = vi.fn<typeof fetch>()
vi.stubGlobal('fetch', fetchMock)
afterEach(() => fetchMock.mockReset())

/** Node 25's own (file-less) localStorage shadows jsdom's, so tests bring their own. */
function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

function memoryCache(): AssetBackend & { map: Map<string, Blob> } {
  const map = new Map<string, Blob>()
  return { map, put: async (id, b) => void map.set(id, b), get: async (id) => map.get(id) ?? null }
}
const blob = (n = 3) => new Blob([new Uint8Array(n)], { type: 'image/png' })
const noContent = async () => new Response(null, { status: 204 })

describe('createCloudAssets', () => {
  it('writes locally and uploads', async () => {
    const cache = memoryCache()
    const storage = memoryStorage()
    fetchMock.mockImplementation(noContent)
    await createCloudAssets(cache, storage).put('a1', blob())
    expect(cache.map.has('a1')).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/a1', expect.objectContaining({ method: 'PUT' }))
  })

  it('returns once the file is stored locally, without waiting for the upload', async () => {
    const cache = memoryCache()
    const storage = memoryStorage()
    let finish: (r: Response) => void = () => {}
    fetchMock.mockImplementation(() => new Promise<Response>((r) => (finish = r)))
    const settled = await Promise.race([
      createCloudAssets(cache, storage).put('slow', blob()).then(() => 'put resolved'),
      new Promise((r) => setTimeout(() => r('still waiting'), 100)),
    ])
    expect(settled).toBe('put resolved')
    expect(cache.map.has('slow')).toBe(true)
    // Until the upload lands it is queued, so a closed tab still retries it next start.
    expect(storage.getItem('bb_pending_uploads')).toBe('["slow"]')
    finish(new Response(null, { status: 204 }))
    await vi.waitFor(() => expect(storage.getItem('bb_pending_uploads')).toBe('[]'))
  })

  it('still stores the file when the pending list cannot be written', async () => {
    const cache = memoryCache()
    const storage = memoryStorage()
    storage.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    fetchMock.mockImplementation(noContent)
    await createCloudAssets(cache, storage).put('q', blob())
    expect(cache.map.has('q')).toBe(true)
  })

  it('refuses a file over the limit before storing anything', async () => {
    const cache = memoryCache()
    const storage = memoryStorage()
    const huge = { size: ASSET_MAX_BYTES + 1, type: 'video/mp4' } as Blob
    await expect(createCloudAssets(cache, storage).put('big', huge)).rejects.toThrow('95 MB')
    expect(cache.map.size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps a failed upload locally and retries it later', async () => {
    const cache = memoryCache()
    const storage = memoryStorage()
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    await createCloudAssets(cache, storage).put('a2', blob())
    expect(cache.map.has('a2')).toBe(true)

    fetchMock.mockImplementation(noContent)
    await createCloudAssets(cache, storage).retryPending()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/assets/a2', expect.objectContaining({ method: 'PUT' }))
    fetchMock.mockClear()
    await createCloudAssets(cache, storage).retryPending()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps waiting uploads queued when the retry fails too', async () => {
    const cache = memoryCache()
    const storage = memoryStorage()
    fetchMock.mockRejectedValue(new TypeError('offline'))
    const assets = createCloudAssets(cache, storage)
    await assets.put('a3', blob())
    await assets.retryPending()
    fetchMock.mockReset()
    fetchMock.mockImplementation(noContent)
    await assets.retryPending()
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/a3', expect.objectContaining({ method: 'PUT' }))
  })

  it('reads from the cache first, then the server, caching what it fetched', async () => {
    const cache = memoryCache()
    const storage = memoryStorage()
    cache.map.set('local', blob(1))
    const assets = createCloudAssets(cache, storage)
    expect(await assets.get('local')).toBe(cache.map.get('local'))
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValue(new Response(new Uint8Array(2)))
    const fetched = await assets.get('remote')
    expect(fetched?.size).toBe(2)
    expect(cache.map.has('remote')).toBe(true)
  })

  it('reads a missing asset as null', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"No such asset."}', { status: 404 }))
    expect(await createCloudAssets(memoryCache(), memoryStorage()).get('gone')).toBeNull()
  })
})
