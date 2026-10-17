import type { BoardRepository } from '../types'
import { ApiError, JSON_HEADERS, api } from './api'

const path = (id: string, rest = '') => `/api/boards/${encodeURIComponent(id)}${rest}`

/**
 * The board registry over HTTP. The `userId` arguments are part of the shared
 * interface but are not sent: the Worker only trusts the session cookie.
 */
export function createCloudBoards(): BoardRepository {
  return {
    async list() {
      return (await api('/api/boards')).json()
    },
    async create(_userId, title) {
      return (await api('/api/boards', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ title }) })).json()
    },
    async rename(_userId, id, title) {
      await api(path(id), { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ title }) })
    },
    async markOpened(_userId, id) {
      await api(path(id, '/opened'), { method: 'POST' })
    },
    async remove(_userId, id) {
      await api(path(id), { method: 'DELETE' })
    },
    async savePreview(_userId, id, { image, nodes, media }) {
      await api(path(id, `/preview?nodes=${nodes}&media=${media}`), {
        method: 'PUT',
        headers: image ? { 'Content-Type': image.type } : undefined,
        body: image ?? undefined,
      })
    },
    async getPreview(_userId, id) {
      let res: Response
      try {
        res = await api(path(id, '/preview'))
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
      const blob = await res.blob()
      return {
        image: blob.size > 0 ? blob : null,
        nodes: Number(res.headers.get('x-preview-nodes') ?? 0),
        media: Number(res.headers.get('x-preview-media') ?? 0),
        savedAt: Number(res.headers.get('x-preview-saved-at') ?? 0),
      }
    },
  }
}
