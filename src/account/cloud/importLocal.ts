import * as Y from 'yjs'
import { persistDoc, type Persistence } from '../../document/persistence'
import { nodesMap } from '../../document/schema'
import { createLocalBoards } from '../localBoards'
import { BOARDS, getAll, localDb } from '../localDb'
import type { Backend, BoardPreview, BoardRecord, UserId } from '../types'

export const IMPORT_OFFERED_KEY = 'bb_import_offered'
const PROGRESS_KEY = 'bb_import_progress'

/** How long one board's contents may take to reach the server before the import gives up. */
const SERVER_WAIT_MS = 20_000

/** Which cloud board each local board went to, and whether it got there whole. */
export type ImportProgress = {
  get(localId: string): { cloudId: string; done: boolean } | undefined
  set(localId: string, entry: { cloudId: string; done: boolean }): void
}

export type ImportDeps = {
  localBoards: () => Promise<BoardRecord[]>
  localPreview: (b: BoardRecord) => Promise<BoardPreview | null>
  openLocal: (doc: Y.Doc, boardId: string) => Persistence
  cloud: Pick<Backend, 'boards' | 'persistBoard' | 'assets'>
  progress: ImportProgress
  serverWaitMs?: number
}

function assetIds(doc: Y.Doc): string[] {
  const ids: string[] = []
  for (const node of nodesMap(doc).values()) {
    const id = node.get('assetId')
    if (typeof id === 'string') ids.push(id)
  }
  return ids
}

function withinMs(p: Promise<void>, ms: number, message: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)))
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Copies boards made with the in-browser backend into the signed-in cloud
 * account. Each gets a fresh server id rather than keeping its own — the
 * pre-accounts board is `default` in every browser — so its contents are
 * copied into a new document, not adopted in place. The local originals are
 * left alone.
 *
 * Safe to run again after a failure: which cloud board each local board went
 * to is recorded as soon as it is made, so a re-run copies into that same
 * board (Yjs merges a repeated copy into nothing new) and skips boards that
 * finished.
 */
export function createImporter(deps: ImportDeps) {
  const serverWaitMs = deps.serverWaitMs ?? SERVER_WAIT_MS
  return {
    /** Local boards not yet copied in full. */
    async find(): Promise<BoardRecord[]> {
      return (await deps.localBoards()).filter((b) => !deps.progress.get(b.id)?.done)
    },

    /** Returns how many boards were copied. */
    async run(userId: UserId, boards: BoardRecord[]): Promise<number> {
      let copied = 0
      for (const b of boards) {
        const source = new Y.Doc()
        const local = deps.openLocal(source, b.id)
        await local.whenSynced
        const state = Y.encodeStateAsUpdate(source)
        const media = assetIds(source)
        await local.destroy()

        let cloudId = deps.progress.get(b.id)?.cloudId
        if (!cloudId) {
          cloudId = (await deps.cloud.boards.create(userId, b.title)).id
          deps.progress.set(b.id, { cloudId, done: false })
        }
        const target = new Y.Doc()
        Y.applyUpdate(target, state)
        const remote = deps.cloud.persistBoard(target, cloudId)
        try {
          await remote.whenSynced
          if (remote.whenServerSynced) {
            await withinMs(remote.whenServerSynced, serverWaitMs, `Couldn't reach the server to upload “${b.title}”.`)
          }
        } finally {
          await remote.destroy()
        }

        for (const id of media) {
          const blob = await deps.cloud.assets.get(id)
          if (blob) await deps.cloud.assets.put(id, blob)
        }
        const preview = await deps.localPreview(b)
        if (preview) await deps.cloud.boards.savePreview(userId, cloudId, { image: preview.image, nodes: preview.nodes, media: preview.media })
        deps.progress.set(b.id, { cloudId, done: true })
        copied++
      }
      return copied
    },
  }
}

/** The importer wired to this browser's real local stores. */
export function browserImporter(cloud: ImportDeps['cloud']) {
  const open = localDb()
  const local = createLocalBoards(open)
  return createImporter({
    localBoards: () => getAll<BoardRecord>(open, BOARDS),
    localPreview: (b) => local.getPreview(b.ownerId, b.id),
    openLocal: persistDoc,
    cloud,
    progress: localStorageProgress(),
  })
}

/** Progress in localStorage. If storage is blocked, a re-run starts over (and may duplicate). */
function localStorageProgress(): ImportProgress {
  const read = (): Record<string, { cloudId: string; done: boolean }> => {
    try {
      return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}')
    } catch {
      return {}
    }
  }
  return {
    get: (id) => read()[id],
    set(id, entry) {
      try {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify({ ...read(), [id]: entry }))
      } catch {
        // see above
      }
    },
  }
}
