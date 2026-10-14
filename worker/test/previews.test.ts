import { describe, expect, it } from 'vitest'
import { call, signIn } from './helpers'

async function board(cookie: string): Promise<string> {
  const res = await call('/api/boards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"title":"p"}' }, cookie)
  return (await res.json<{ id: string }>()).id
}

describe('previews API', () => {
  it('is 404 before anything is saved', async () => {
    const { cookie } = await signIn()
    const id = await board(cookie)
    expect((await call(`/api/boards/${id}/preview`, {}, cookie)).status).toBe(404)
  })

  it('round-trips the picture and the counts', async () => {
    const { cookie } = await signIn()
    const id = await board(cookie)
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    const put = await call(`/api/boards/${id}/preview?nodes=4&media=2`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png }, cookie)
    expect(put.status).toBe(204)
    const res = await call(`/api/boards/${id}/preview`, {}, cookie)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('x-preview-nodes')).toBe('4')
    expect(res.headers.get('x-preview-media')).toBe('2')
    expect(Number(res.headers.get('x-preview-saved-at'))).toBeGreaterThan(0)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png)
  })

  it('stores an empty board as counts with no picture', async () => {
    const { cookie } = await signIn()
    const id = await board(cookie)
    await call(`/api/boards/${id}/preview?nodes=0&media=0`, { method: 'PUT' }, cookie)
    const res = await call(`/api/boards/${id}/preview`, {}, cookie)
    expect(res.status).toBe(200)
    expect((await res.arrayBuffer()).byteLength).toBe(0)
  })

  it('is 404 for someone else’s board', async () => {
    const alice = await signIn()
    const bob = await signIn()
    const id = await board(alice.cookie)
    expect((await call(`/api/boards/${id}/preview?nodes=1&media=0`, { method: 'PUT', body: 'x' }, bob.cookie)).status).toBe(404)
    expect((await call(`/api/boards/${id}/preview`, {}, bob.cookie)).status).toBe(404)
  })
})
