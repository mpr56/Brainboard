import { nanoid } from 'nanoid'
import { fail, json } from './http'
import { onBoardDeleted } from './lifecycle'

type Row = { id: string; owner_id: string; title: string; created_at: number; opened_at: number }

const toRecord = (r: Row) => ({ id: r.id, ownerId: r.owner_id, title: r.title, createdAt: r.created_at, openedAt: r.opened_at })

const MAX_TITLE = 200

function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return t.length >= 1 && t.length <= MAX_TITLE ? t : null
}

async function readTitle(request: Request): Promise<string | null> {
  const body = await request.json<{ title?: unknown }>().catch(() => null)
  return cleanTitle(body?.title)
}

export async function ownsBoard(env: Env, userId: string, boardId: string): Promise<boolean> {
  const row = await env.DB.prepare('select 1 from boards where id = ?1 and owner_id = ?2').bind(boardId, userId).first()
  return row !== null
}

const NOT_FOUND = () => fail(404, 'No such board.')
const BAD_TITLE = () => fail(400, `A title is 1 to ${MAX_TITLE} characters.`)
const NO_CONTENT = () => new Response(null, { status: 204 })

/**
 * The board registry. Every statement is scoped to `userId`, so a board that
 * isn't the caller's behaves exactly like one that doesn't exist.
 */
export async function routeBoards(env: Env, userId: string, request: Request, url: URL): Promise<Response | null> {
  const parts = url.pathname.split('/').filter(Boolean) // ['api', 'boards', id?, action?]
  if (parts[0] !== 'api' || parts[1] !== 'boards') return null
  const [, , rawId, action] = parts
  const method = request.method

  if (!rawId) {
    if (method === 'GET') {
      const { results } = await env.DB.prepare('select * from boards where owner_id = ?1 order by created_at, id').bind(userId).all<Row>()
      return json(results.map(toRecord))
    }
    if (method === 'POST') {
      const title = await readTitle(request)
      if (!title) return BAD_TITLE()
      const t = Date.now()
      const row: Row = { id: nanoid(12), owner_id: userId, title, created_at: t, opened_at: t }
      await env.DB.prepare('insert into boards (id, owner_id, title, created_at, opened_at) values (?1, ?2, ?3, ?4, ?5)')
        .bind(row.id, row.owner_id, row.title, row.created_at, row.opened_at)
        .run()
      return json(toRecord(row), { status: 201 })
    }
    return null
  }

  const id = decodeURIComponent(rawId)
  if (action === undefined && method === 'PATCH') {
    const title = await readTitle(request)
    if (!title) return BAD_TITLE()
    const r = await env.DB.prepare('update boards set title = ?1 where id = ?2 and owner_id = ?3').bind(title, id, userId).run()
    return r.meta.changes ? NO_CONTENT() : NOT_FOUND()
  }
  if (action === 'opened' && method === 'POST') {
    const r = await env.DB.prepare('update boards set opened_at = ?1 where id = ?2 and owner_id = ?3').bind(Date.now(), id, userId).run()
    return r.meta.changes ? NO_CONTENT() : NOT_FOUND()
  }
  if (action === undefined && method === 'DELETE') {
    const r = await env.DB.prepare('delete from boards where id = ?1 and owner_id = ?2').bind(id, userId).run()
    if (!r.meta.changes) return NOT_FOUND()
    await onBoardDeleted(env, id)
    return NO_CONTENT()
  }
  return null
}
