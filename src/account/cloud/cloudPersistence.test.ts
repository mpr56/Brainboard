import { describe, expect, it } from 'vitest'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import { boardKey } from '../../document/persistence'
import { nodesMap } from '../../document/schema'
import { createCloudPersistence, type Remote } from './cloudPersistence'

/** Stands in for the socket: records listeners so a test can play the server's events. */
function fakeRemote() {
  const listeners = new Map<string, ((arg: never) => void)[]>()
  return {
    destroyed: false,
    on(event: string, cb: (arg: never) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), cb])
    },
    emit(event: 'status' | 'sync', arg: unknown) {
      for (const cb of listeners.get(event) ?? []) (cb as (a: unknown) => void)(arg)
    },
    destroy() {
      this.destroyed = true
    },
  } satisfies Remote & Record<string, unknown>
}

const uniqueId = () => `t-${Math.random().toString(36).slice(2)}`

async function seedLocal(boardId: string) {
  const doc = new Y.Doc()
  const p = new IndexeddbPersistence(boardKey(boardId), doc)
  await p.whenSynced
  nodesMap(doc).set('n1', new Y.Map())
  await new Promise((r) => setTimeout(r, 50))
  await p.destroy()
}

describe('createCloudPersistence', () => {
  it('opens from the local copy without waiting for the server', async () => {
    const id = uniqueId()
    await seedLocal(id)
    const remote = fakeRemote()
    const doc = new Y.Doc()
    const p = createCloudPersistence(() => remote, 10_000)(doc, id)
    await p.whenSynced
    expect(nodesMap(doc).has('n1')).toBe(true)
    await p.destroy()
    expect(remote.destroyed).toBe(true)
  })

  it('waits for the server when the cache is empty (first open on this device)', async () => {
    const remote = fakeRemote()
    const p = createCloudPersistence(() => remote, 10_000)(new Y.Doc(), uniqueId())
    let done = false
    void p.whenSynced.then(() => (done = true))
    await new Promise((r) => setTimeout(r, 50))
    expect(done).toBe(false)
    remote.emit('sync', true)
    await p.whenSynced
    await p.destroy()
  })

  it('gives up waiting on the server after a while, so an empty board opens offline', async () => {
    const p = createCloudPersistence(() => fakeRemote(), 30)(new Y.Doc(), uniqueId())
    await p.whenSynced
    await p.destroy()
  })

  it('reports connection status', async () => {
    const remote = fakeRemote()
    const p = createCloudPersistence(() => remote, 10)(new Y.Doc(), uniqueId())
    const seen: string[] = []
    p.status!.subscribe((s) => seen.push(s))
    expect(p.status!.get()).toBe('connecting')
    remote.emit('status', { status: 'connected' })
    remote.emit('status', { status: 'disconnected' })
    expect(seen).toEqual(['online', 'offline'])
    await p.destroy()
  })

  it('goes offline as soon as the browser does, without waiting for the socket to notice', async () => {
    const remote = fakeRemote()
    const p = createCloudPersistence(() => remote, 10)(new Y.Doc(), uniqueId())
    remote.emit('status', { status: 'connected' })
    const seen: string[] = []
    p.status!.subscribe((s) => seen.push(s))
    window.dispatchEvent(new Event('offline'))
    expect(p.status!.get()).toBe('offline')
    window.dispatchEvent(new Event('online'))
    expect(p.status!.get()).toBe('online')
    expect(seen).toEqual(['offline', 'online'])
    await p.destroy()
    window.dispatchEvent(new Event('offline'))
    expect(seen).toEqual(['offline', 'online'])
  })

  it('resolves whenServerSynced on the first sync', async () => {
    const remote = fakeRemote()
    const p = createCloudPersistence(() => remote, 10)(new Y.Doc(), uniqueId())
    remote.emit('sync', true)
    await p.whenServerSynced
    await p.destroy()
  })
})
