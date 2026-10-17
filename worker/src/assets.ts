import { fail } from './http'

export const ASSET_MAX_BYTES = 95 * 1024 * 1024
const ID = /^[A-Za-z0-9_-]{1,64}$/
const key = (id: string) => `assets/${id}`

export const tooBig = (request: Request): boolean => Number(request.headers.get('content-length') ?? 0) > ASSET_MAX_BYTES

/**
 * Media bytes, in R2. Ids are random and an asset never changes once written
 * (the client makes a new id for a new file), so a second PUT of the same id
 * is a retry, and reads can be cached forever.
 */
export async function routeAssets(env: Env, userId: string, request: Request, url: URL): Promise<Response | null> {
  const m = url.pathname.match(/^\/api\/assets\/([^/]+)$/)
  if (!m) return null
  const id = decodeURIComponent(m[1]!)
  if (!ID.test(id)) return fail(400, 'Bad asset id.')

  const owner = await env.DB.prepare('select owner_id from assets where id = ?1').bind(id).first<{ owner_id: string }>()

  if (request.method === 'PUT') {
    if (owner && owner.owner_id !== userId) return fail(403, 'That asset id is taken.')
    if (owner) return new Response(null, { status: 204 })
    if (tooBig(request)) return fail(413, 'Files are limited to 95 MB.')
    const type = request.headers.get('content-type') ?? 'application/octet-stream'
    const obj = await env.BUCKET.put(key(id), request.body, { httpMetadata: { contentType: type } })
    await env.DB.prepare('insert into assets (id, owner_id, type, size) values (?1, ?2, ?3, ?4)')
      .bind(id, userId, type, obj?.size ?? 0)
      .run()
    return new Response(null, { status: 204 })
  }

  if (request.method === 'GET') {
    if (!owner || owner.owner_id !== userId) return fail(404, 'No such asset.')
    const obj = await env.BUCKET.get(key(id))
    if (!obj) return fail(404, 'No such asset.')
    return new Response(obj.body, {
      headers: {
        'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
        'cache-control': 'private, max-age=31536000, immutable',
      },
    })
  }
  return null
}
