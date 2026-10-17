import { ownsBoard } from './boards'
import { fail } from './http'

const key = (boardId: string) => `previews/${boardId}`
const count = (raw: string | null) => Math.max(0, Math.floor(Number(raw) || 0))

/**
 * The home screen's picture of a board, in R2, with its counts on the board's
 * row. An empty body means "no picture" (an empty board), which is different
 * from "never saved" (404).
 */
export async function routePreviews(env: Env, userId: string, request: Request, url: URL): Promise<Response | null> {
  const m = url.pathname.match(/^\/api\/boards\/([^/]+)\/preview$/)
  if (!m) return null
  const boardId = decodeURIComponent(m[1]!)
  if (!(await ownsBoard(env, userId, boardId))) return fail(404, 'No such board.')

  if (request.method === 'PUT') {
    const bytes = await request.arrayBuffer()
    if (bytes.byteLength > 0) {
      await env.BUCKET.put(key(boardId), bytes, { httpMetadata: { contentType: request.headers.get('content-type') ?? 'image/png' } })
    } else {
      await env.BUCKET.delete(key(boardId))
    }
    await env.DB.prepare('update boards set preview_nodes = ?1, preview_media = ?2, preview_saved_at = ?3 where id = ?4')
      .bind(count(url.searchParams.get('nodes')), count(url.searchParams.get('media')), Date.now(), boardId)
      .run()
    return new Response(null, { status: 204 })
  }

  if (request.method === 'GET') {
    const row = await env.DB.prepare('select preview_nodes as n, preview_media as m, preview_saved_at as t from boards where id = ?1')
      .bind(boardId)
      .first<{ n: number | null; m: number | null; t: number | null }>()
    if (!row || row.t === null) return fail(404, 'No preview yet.')
    const obj = await env.BUCKET.get(key(boardId))
    return new Response(obj ? obj.body : null, {
      headers: {
        'content-type': obj?.httpMetadata?.contentType ?? 'application/octet-stream',
        'x-preview-nodes': String(row.n ?? 0),
        'x-preview-media': String(row.m ?? 0),
        'x-preview-saved-at': String(row.t),
        'cache-control': 'no-store',
      },
    })
  }
  return null
}
