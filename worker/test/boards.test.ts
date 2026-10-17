import { describe, expect, it } from 'vitest'
import { call, signIn } from './helpers'

type Board = { id: string; ownerId: string; title: string; createdAt: number; openedAt: number }
const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function create(cookie: string, title: string): Promise<Board> {
  const res = await call('/api/boards', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ title }) }, cookie)
  expect(res.status).toBe(201)
  return res.json()
}
const list = async (cookie: string) => (await call('/api/boards', {}, cookie)).json<Board[]>()

describe('boards API', () => {
  it('refuses requests without a session', async () => {
    const res = await call('/api/boards')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Not signed in.' })
  })

  it('creates and lists a user’s boards, oldest first', async () => {
    const { cookie, userId } = await signIn()
    const a = await create(cookie, 'First')
    const b = await create(cookie, 'Second')
    expect(a).toMatchObject({ ownerId: userId, title: 'First' })
    expect((await list(cookie)).map((x) => x.id)).toEqual([a.id, b.id])
  })

  it('trims titles and rejects empty or overlong ones', async () => {
    const { cookie } = await signIn()
    expect((await create(cookie, '  Spaced  ')).title).toBe('Spaced')
    for (const title of ['   ', 'x'.repeat(201)]) {
      const res = await call('/api/boards', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ title }) }, cookie)
      expect(res.status).toBe(400)
    }
  })

  it('renames and marks opened', async () => {
    const { cookie } = await signIn()
    const b = await create(cookie, 'Old')
    const renamed = await call(`/api/boards/${b.id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ title: 'New' }) }, cookie)
    expect(renamed.status).toBe(204)
    expect((await call(`/api/boards/${b.id}/opened`, { method: 'POST' }, cookie)).status).toBe(204)
    const [after] = await list(cookie)
    expect(after!.title).toBe('New')
    expect(after!.openedAt).toBeGreaterThanOrEqual(b.openedAt)
  })

  it('hides other users’ boards: 404 on every route', async () => {
    const alice = await signIn()
    const bob = await signIn()
    const b = await create(alice.cookie, 'Alice’s')
    expect(await list(bob.cookie)).toEqual([])
    const tries = [
      call(`/api/boards/${b.id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ title: 'x' }) }, bob.cookie),
      call(`/api/boards/${b.id}/opened`, { method: 'POST' }, bob.cookie),
      call(`/api/boards/${b.id}`, { method: 'DELETE' }, bob.cookie),
    ]
    for (const res of await Promise.all(tries)) expect(res.status).toBe(404)
    expect(await list(alice.cookie)).toHaveLength(1)
  })

  it('deletes', async () => {
    const { cookie } = await signIn()
    const b = await create(cookie, 'Doomed')
    expect((await call(`/api/boards/${b.id}`, { method: 'DELETE' }, cookie)).status).toBe(204)
    expect(await list(cookie)).toEqual([])
  })
})
