import { describe, expect, it } from 'vitest'
import { tooBig } from '../src/assets'
import { call, signIn } from './helpers'

const put = (id: string, body: BodyInit, cookie: string, headers: HeadersInit = { 'Content-Type': 'image/gif' }) =>
  call(`/api/assets/${id}`, { method: 'PUT', body, headers }, cookie)

describe('assets API', () => {
  it('stores and serves bytes to their owner', async () => {
    const { cookie } = await signIn()
    expect((await put('asset_ok1', new Uint8Array([1, 2, 3]), cookie)).status).toBe(204)
    const res = await call('/api/assets/asset_ok1', {}, cookie)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/gif')
    expect(res.headers.get('cache-control')).toContain('immutable')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('treats a repeat upload by the owner as done', async () => {
    const { cookie } = await signIn()
    await put('asset_rep', new Uint8Array([1]), cookie)
    expect((await put('asset_rep', new Uint8Array([9]), cookie)).status).toBe(204)
    expect(new Uint8Array(await (await call('/api/assets/asset_rep', {}, cookie)).arrayBuffer())).toEqual(new Uint8Array([1]))
  })

  it('will not let someone overwrite or read another user’s asset', async () => {
    const alice = await signIn()
    const bob = await signIn()
    await put('asset_alice', new Uint8Array([1]), alice.cookie)
    expect((await put('asset_alice', new Uint8Array([2]), bob.cookie)).status).toBe(403)
    expect((await call('/api/assets/asset_alice', {}, bob.cookie)).status).toBe(404)
  })

  it('rejects bad ids', async () => {
    const { cookie } = await signIn()
    expect((await put('bad%20id', new Uint8Array([1]), cookie)).status).toBe(400)
  })

  it('judges a body over 95 MB too big by its declared length', () => {
    const at = (n: number) => new Request('http://x/', { method: 'PUT', headers: { 'Content-Length': String(n) } })
    expect(tooBig(at(95 * 1024 * 1024))).toBe(false)
    expect(tooBig(at(95 * 1024 * 1024 + 1))).toBe(true)
  })

  it('is 404 for an asset never uploaded', async () => {
    const { cookie } = await signIn()
    expect((await call('/api/assets/never', {}, cookie)).status).toBe(404)
  })
})
