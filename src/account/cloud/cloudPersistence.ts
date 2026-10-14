import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import type * as Y from 'yjs'
import { boardKey, type Persistence, type SyncStatus } from '../../document/persistence'
import { edgesMap, nodesMap } from '../../document/schema'

/** partyserver's route for the BOARD_ROOM binding (kebab-cased) — see worker/src/index.ts. */
export const ROOM_PATH = '/parties/board-room'

export type Remote = {
  on(event: 'status', cb: (e: { status: string }) => void): void
  on(event: 'sync', cb: (synced: boolean) => void): void
  destroy(): void
}
export type RemoteFactory = (boardId: string, doc: Y.Doc) => Remote

/**
 * y-partyserver speaks y-websocket's protocol, so its plain client is enough —
 * and keeps y-partyserver (and its Cloudflare type peers) out of the app.
 */
const socketRemote: RemoteFactory = (boardId, doc) => {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return new WebsocketProvider(`${proto}//${location.host}${ROOM_PATH}`, boardId, doc)
}

/** How long a board with nothing in the local copy waits for the server before opening anyway. */
const EMPTY_WAIT_MS = 4000

/**
 * A board kept in this browser's IndexedDB *and* in its room on the server.
 * The local copy is what the board opens from, so a board seen before on this
 * device opens instantly and works offline; Yjs merges the two both ways when
 * the socket connects.
 *
 * A board never opened here has an empty local copy. Showing that would flash
 * an empty canvas (and let the user start drawing on it) before the real
 * contents arrive, so it waits for the server — but only so long, or a
 * genuinely empty board could not be opened offline.
 */
export function createCloudPersistence(makeRemote: RemoteFactory = socketRemote, emptyWaitMs = EMPTY_WAIT_MS) {
  return (doc: Y.Doc, boardId: string): Persistence => {
    const local = new IndexeddbPersistence(boardKey(boardId), doc)
    const remote = makeRemote(boardId, doc)

    // The socket's own view, and the browser's. A dropped network can leave a
    // socket looking open until y-websocket's 30 s message timeout, so the
    // browser's offline event is believed at once.
    let socket: SyncStatus = 'connecting'
    let browserOnline = navigator.onLine !== false
    let status: SyncStatus = browserOnline ? socket : 'offline'
    const listeners = new Set<(s: SyncStatus) => void>()
    const update = () => {
      const next = browserOnline ? socket : 'offline'
      if (next === status) return
      status = next
      for (const l of listeners) l(status)
    }
    remote.on('status', ({ status: s }) => {
      socket = s === 'connected' ? 'online' : s === 'connecting' ? 'connecting' : 'offline'
      update()
    })
    const onOnline = () => {
      browserOnline = true
      update()
    }
    const onOffline = () => {
      browserOnline = false
      update()
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    const whenServerSynced = new Promise<void>((resolve) => {
      remote.on('sync', (synced) => synced && resolve())
    })

    const whenSynced = local.whenSynced.then(async () => {
      if (nodesMap(doc).size > 0 || edgesMap(doc).size > 0) return
      await Promise.race([whenServerSynced, new Promise((r) => setTimeout(r, emptyWaitMs))])
    })

    return {
      whenSynced,
      whenServerSynced,
      status: {
        get: () => status,
        subscribe(cb) {
          listeners.add(cb)
          return () => listeners.delete(cb)
        },
      },
      async destroy() {
        window.removeEventListener('online', onOnline)
        window.removeEventListener('offline', onOffline)
        remote.destroy()
        await local.destroy()
      },
    }
  }
}
