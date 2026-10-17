import { describe, expect, it, vi } from 'vitest'
import { LEGACY_BOARD_ID, createLocalBoards } from './localBoards'
import { localDb } from './localDb'

const ALICE = 'alice'
const BOB = 'bob'

function repo(over: { now?: () => number } = {}) {
  const clearContents = vi.fn().mockResolvedValue(undefined)
  let n = 0
  const boards = createLocalBoards(localDb(`accounts-${Math.random().toString(36).slice(2)}`), {
    clearContents,
    newId: () => `b${++n}`,
    ...over,
  })
  return { boards, clearContents }
}

describe('createLocalBoards', () => {
  it("gives the first user the board from before accounts existed", async () => {
    const { boards } = repo()
    const list = await boards.list(ALICE)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: LEGACY_BOARD_ID, ownerId: ALICE })
  })

  it('adopts that board only once', async () => {
    const { boards } = repo()
    await boards.list(ALICE)
    expect(await boards.list(BOB)).toEqual([])
    // Not even after its owner deletes it.
    await boards.remove(ALICE, LEGACY_BOARD_ID)
    expect(await boards.list(ALICE)).toEqual([])
  })

  it('lists only the asking user’s boards, oldest first', async () => {
    let t = 0
    const { boards } = repo({ now: () => ++t })
    await boards.list(ALICE)
    const second = await boards.create(ALICE, 'Second')
    await boards.create(BOB, 'Not yours')
    const third = await boards.create(ALICE, 'Third')
    expect((await boards.list(ALICE)).map((b) => b.id)).toEqual([LEGACY_BOARD_ID, second.id, third.id])
    expect((await boards.list(BOB)).map((b) => b.title)).toEqual(['Not yours'])
  })

  it('creates a board as just opened', async () => {
    const { boards } = repo({ now: () => 42 })
    const b = await boards.create(ALICE, 'Plans')
    expect(b).toEqual({ id: 'b1', ownerId: ALICE, title: 'Plans', createdAt: 42, openedAt: 42 })
  })

  it('renames a board, trimming the title', async () => {
    const { boards } = repo()
    const b = await boards.create(ALICE, 'Old')
    await boards.rename(ALICE, b.id, '  New  ')
    expect((await boards.list(ALICE)).find((x) => x.id === b.id)?.title).toBe('New')
  })

  it('records when a board was opened', async () => {
    let t = 10
    const { boards } = repo({ now: () => t })
    const b = await boards.create(ALICE, 'X')
    t = 99
    await boards.markOpened(ALICE, b.id)
    expect((await boards.list(ALICE)).find((x) => x.id === b.id)?.openedAt).toBe(99)
  })

  it('removes a board and its contents', async () => {
    const { boards, clearContents } = repo()
    const b = await boards.create(ALICE, 'Gone')
    await boards.remove(ALICE, b.id)
    expect((await boards.list(ALICE)).some((x) => x.id === b.id)).toBe(false)
    expect(clearContents).toHaveBeenCalledWith(b.id)
  })

  it('refuses to touch another user’s board', async () => {
    const { boards, clearContents } = repo()
    const b = await boards.create(ALICE, 'Mine')
    await expect(boards.rename(BOB, b.id, 'Ha')).rejects.toThrow()
    await expect(boards.markOpened(BOB, b.id)).rejects.toThrow()
    await expect(boards.remove(BOB, b.id)).rejects.toThrow()
    expect(clearContents).not.toHaveBeenCalled()
    expect((await boards.list(ALICE))[0]?.title).toBe('Mine')
  })
})

describe('board previews', () => {
  it('saves and reads back a preview', async () => {
    const { boards } = repo({ now: () => 7 })
    const b = await boards.create(ALICE, 'X')
    expect(await boards.getPreview(ALICE, b.id)).toBeNull()
    await boards.savePreview(ALICE, b.id, { image: null, nodes: 3, media: 1 })
    expect(await boards.getPreview(ALICE, b.id)).toEqual({ image: null, nodes: 3, media: 1, savedAt: 7 })
  })

  it('keeps the picture', async () => {
    const { boards } = repo()
    const b = await boards.create(ALICE, 'X')
    await boards.savePreview(ALICE, b.id, { image: new Blob(['png'], { type: 'image/png' }), nodes: 1, media: 0 })
    const image = (await boards.getPreview(ALICE, b.id))?.image
    expect(image?.type).toBe('image/png')
    expect(image?.size).toBe(3)
  })

  it('drops the preview with its board', async () => {
    const { boards } = repo()
    const b = await boards.create(ALICE, 'X')
    await boards.savePreview(ALICE, b.id, { image: null, nodes: 1, media: 0 })
    await boards.remove(ALICE, b.id)
    const again = await boards.create(ALICE, 'Y')
    expect(again.id).not.toBe(b.id)
    await expect(boards.getPreview(ALICE, b.id)).rejects.toThrow()
  })

  it('keeps previews to their owner', async () => {
    const { boards } = repo()
    const b = await boards.create(ALICE, 'X')
    await expect(boards.savePreview(BOB, b.id, { image: null, nodes: 0, media: 0 })).rejects.toThrow()
    await expect(boards.getPreview(BOB, b.id)).rejects.toThrow()
  })
})
