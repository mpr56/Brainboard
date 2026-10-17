import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCloudBoards } from './cloudBoards'

const fetchMock = vi.fn<typeof fetch>()
vi.stubGlobal('fetch', fetchMock)
afterEach(() => fetchMock.mockReset())

const ok = (body: unknown, init: ResponseInit = {}) =>
  new Response(body === null ? null : typeof body === 'string' || body instanceof Blob ? body : JSON.stringify(body), { status: 200, ...init })

describe('createCloudBoards', () => {
  const boards = createCloudBoards()

  it('lists', async () => {
    fetchMock.mockResolvedValue(ok([{ id: 'b1' }]))
    expect(await boards.list('u')).toEqual([{ id: 'b1' }])
    expect(fetchMock).toHaveBeenCalledWith('/api/boards', expect.objectContaining({ credentials: 'same-origin' }))
  })

  it('creates with a JSON title', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'b2', title: 'T' }, { status: 201 }))
    await boards.create('u', 'T')
    const [path, init] = fetchMock.mock.calls[0]!
    expect(path).toBe('/api/boards')
    expect(init).toMatchObject({ method: 'POST', body: '{"title":"T"}' })
  })

  it('renames, marks opened, removes', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }))
    await boards.rename('u', 'b 1', 'New')
    await boards.markOpened('u', 'b 1')
    await boards.remove('u', 'b 1')
    expect(fetchMock.mock.calls.map(([p, i]) => `${i?.method} ${p}`)).toEqual([
      'PATCH /api/boards/b%201',
      'POST /api/boards/b%201/opened',
      'DELETE /api/boards/b%201',
    ])
  })

  it('throws the server’s message', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"No such board."}', { status: 404 }))
    await expect(boards.rename('u', 'x', 'y')).rejects.toThrow('No such board.')
  })

  it('saves a preview as bytes plus counts', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const image = new Blob([new Uint8Array([1])], { type: 'image/png' })
    await boards.savePreview('u', 'b1', { image, nodes: 3, media: 1 })
    const [path, init] = fetchMock.mock.calls[0]!
    expect(path).toBe('/api/boards/b1/preview?nodes=3&media=1')
    expect(init).toMatchObject({ method: 'PUT', body: image, headers: { 'Content-Type': 'image/png' } })
  })

  it('reads a preview, with an empty body meaning no picture', async () => {
    const headers = { 'x-preview-nodes': '0', 'x-preview-media': '0', 'x-preview-saved-at': '42' }
    fetchMock.mockResolvedValue(ok(null, { headers }))
    expect(await boards.getPreview('u', 'b1')).toEqual({ image: null, nodes: 0, media: 0, savedAt: 42 })
  })

  it('reads a missing preview as null', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"No preview yet."}', { status: 404 }))
    expect(await boards.getPreview('u', 'b1')).toBeNull()
  })
})
