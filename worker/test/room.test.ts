import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { readState, writeState, type BoardRoom } from '../src/room'
import { call, signIn } from './helpers'

const upgrade = (boardId: string, cookie?: string) =>
  call(`/parties/board-room/${boardId}`, { headers: { Upgrade: 'websocket' } }, cookie)

async function board(cookie: string): Promise<string> {
  const res = await call('/api/boards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"title":"r"}' }, cookie)
  return (await res.json<{ id: string }>()).id
}

describe('room storage', () => {
  it('round-trips state larger than one SQLite row (2 MB)', async () => {
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName('chunks'))
    await runInDurableObject(stub, (_room: BoardRoom, state) => {
      const big = new Uint8Array(2_500_000).map((_, i) => i % 251)
      writeState(state.storage, big)
      expect(readState(state.storage.sql)).toEqual(big)
      writeState(state.storage, new Uint8Array([7]))
      expect(readState(state.storage.sql)).toEqual(new Uint8Array([7]))
    })
  })

  it('reads nothing from a fresh room', async () => {
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName('fresh'))
    await runInDurableObject(stub, (_room: BoardRoom, state) => {
      expect(readState(state.storage.sql)).toBeNull()
    })
  })

  it('stays empty after wipe, even if a debounced save fires late', async () => {
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName('wiped'))
    await runInDurableObject(stub, async (room: BoardRoom, state) => {
      writeState(state.storage, new Uint8Array([1, 2, 3]))
      await room.wipe()
      await room.onSave()
      expect(readState(state.storage.sql)).toBeNull()
    })
  })
})

describe('room gate', () => {
  it('401 without a session', async () => {
    expect((await upgrade('anything')).status).toBe(401)
  })

  it('404 for a board the user does not own', async () => {
    const alice = await signIn()
    const bob = await signIn()
    const id = await board(alice.cookie)
    expect((await upgrade(id, bob.cookie)).status).toBe(404)
  })

  it('404 once the board is deleted', async () => {
    const { cookie } = await signIn()
    const id = await board(cookie)
    await call(`/api/boards/${id}`, { method: 'DELETE' }, cookie)
    expect((await upgrade(id, cookie)).status).toBe(404)
  })

  it('upgrades for the owner', async () => {
    const { cookie } = await signIn()
    const id = await board(cookie)
    const res = await upgrade(id, cookie)
    expect(res.status).toBe(101)
    res.webSocket!.accept()
    res.webSocket!.close()
  })
})
