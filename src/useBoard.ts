import { useEffect, useMemo, useState } from 'react'
import type * as Y from 'yjs'
import { createDoc } from './document/schema'
import { createDocStore, type DocStore } from './document/store'
import { createUndoManager } from './document/undo'
import { persistDoc } from './document/persistence'
import type { Edge, Node } from './types'

export type Board = {
  doc: Y.Doc
  store: DocStore
  undo: Y.UndoManager
  ready: boolean
  error: string | null
}

// A store that never touches a real Y.Doc, so it needs no teardown. Used only
// for the brief window before the effect below hands back a live one.
// getNodes/getEdges must return the SAME array reference on every call —
// useSyncExternalStore (which useNodes/useEdges are built on) treats a new
// reference as a changed snapshot and warns of (and can loop on) an
// uncached getSnapshot if given a fresh `[]` each time.
const EMPTY_NODES: Node[] = []
const EMPTY_EDGES: Edge[] = []
const EMPTY_STORE: DocStore = {
  subscribe: () => () => {},
  getNodes: () => EMPTY_NODES,
  getEdges: () => EMPTY_EDGES,
  getEdgeStyle: () => 'curve',
  getRevision: () => 0,
  destroy: () => {},
}

/**
 * `persist` is the backend's board loader (see account/types.ts). It must keep
 * one identity for the life of the app — it is an effect dependency, so a new
 * function each render would reload the board each render.
 */
export function useBoard(boardId: string, persist: typeof persistDoc = persistDoc): Board {
  const doc = useMemo(() => createDoc(), [boardId])
  const undo = useMemo(() => createUndoManager(doc), [doc])

  const [store, setStore] = useState<DocStore>(EMPTY_STORE)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // The store's Yjs subscriptions (`nodesMap.observeDeep`, etc.) are bound
    // once at construction and permanently severed by `destroy()` — there is
    // no way to "resume" a destroyed store. So it must be created *inside*
    // this effect, symmetric with `persistDoc` below, rather than once
    // outside it (e.g. in a `useMemo`). React's development StrictMode
    // intentionally mounts every effect, cleans it up, and mounts it again,
    // specifically to catch effects that don't tolerate that remount. A
    // store built outside this effect would have its listeners destroyed by
    // the first (synthetic) cleanup and never reattached: `addNode` etc.
    // would keep writing to the document while the UI silently stopped
    // observing it — exactly the failure this once shipped with.
    let alive = true
    const liveStore = createDocStore(doc)
    setStore(liveStore)
    setReady(false)
    setError(null)

    // IndexedDB can be unavailable (private browsing, quota exhausted,
    // storage disabled), and persistDoc can fail to report that in three
    // different ways -- all must be caught, or the app sits on "Loading
    // board..." forever with no explanation:
    //   1. persistDoc() itself throws synchronously.
    //   2. whenSynced asynchronously rejects.
    //   3. whenSynced never settles at all: y-indexeddb's own constructor
    //      does `this._db.then(db => ...)` with no rejection handler, so an
    //      `indexedDB.open` failure becomes an unhandled rejection *inside*
    //      the library and the 'synced' event that would resolve
    //      `whenSynced` simply never fires. Verified directly against the
    //      installed y-indexeddb: a forced open failure hangs, it does not
    //      reject. Only a bounded wait turns that hang into a visible error.
    let settled = false
    const onFailure = (err: unknown) => {
      if (settled || !alive) return
      settled = true
      setError(err instanceof Error ? err.message : String(err))
    }

    let p: ReturnType<typeof persist> | null = null
    try {
      p = persist(doc, boardId)
    } catch (err) {
      onFailure(err)
    }

    const timeoutId = p
      ? setTimeout(() => onFailure(new Error('Timed out waiting for the board to load.')), 8000)
      : null

    p?.whenSynced.then(() => {
      if (settled || !alive) return
      settled = true
      if (timeoutId !== null) clearTimeout(timeoutId)
      setReady(true)
    }, onFailure)

    return () => {
      alive = false
      if (timeoutId !== null) clearTimeout(timeoutId)
      void p?.destroy()
      liveStore.destroy()
    }
  }, [doc, boardId, persist])

  return { doc, store, undo, ready, error }
}
