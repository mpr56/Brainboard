import type * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'

export type SyncStatus = 'connecting' | 'online' | 'offline'

export type Persistence = {
  /** Resolves once the board can be shown: the on-disk state is merged into the document. */
  whenSynced: Promise<void>
  destroy: () => Promise<void>
  /** Whether a server copy is being kept in step. Absent for in-browser-only persistence. */
  status?: { get(): SyncStatus; subscribe(cb: (s: SyncStatus) => void): () => void }
  /** Resolves once the server has everything this document has. Absent for in-browser-only persistence. */
  whenServerSynced?: Promise<void>
}

export const boardKey = (boardId: string) => `brainstorm-canvas/${boardId}`

export function persistDoc(doc: Y.Doc, boardId: string): Persistence {
  const provider = new IndexeddbPersistence(boardKey(boardId), doc)
  return {
    whenSynced: provider.whenSynced.then(() => undefined),
    destroy: () => provider.destroy(),
  }
}
