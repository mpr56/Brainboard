import * as Y from 'yjs'
import { persistDoc, type Persistence } from '../../document/persistence'
import { nodesMap } from '../../document/schema'
import { createLocalBoards } from '../localBoards'
import { BOARDS, getAll, localDb } from '../localDb'
import type { Backend, BoardPreview, BoardRecord, UserId } from '../types'

export const IMPORT_OFFERED_KEY = 'bb_import_offered'

export type ImportDeps = {
  localBoards: () => Promise<BoardRecord[]>
  localPreview: (b: BoardRecord) => Promise<BoardPreview | null>
  openLocal: (doc: Y.Doc, boardId: string) => Persistence
  cloud: Pick<Backend, 'boards' | 'persistBoard' | 'assets'>
}

function assetIds(doc: Y.Doc): string[] {
  const ids: string[] = []
  for (const node of nodesMap(doc).values()) {
    const id = node.get('assetId')
    if (typeof id === 'string') ids.push(id)
  }
  return ids
}

/**
 * Copies boards made with the in-browser backend into the signed-in cloud
 * account. Each gets a fresh server id rather than keeping its own — the
 * pre-accounts board is `default` in every browser — so its contents are
 * copied into a new document, not adopted in place. The local originals are
 * left alone.
 */
export function createImporter(deps: ImportDeps) {
  return {
    find: deps.localBoards,

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

        const made = await deps.cloud.boards.create(userId, b.title)
        const target = new Y.Doc()
        Y.applyUpdate(target, state)
        const remote = deps.cloud.persistBoard(target, made.id)
        await remote.whenSynced
        await remote.whenServerSynced
        await remote.destroy()

        for (const id of media) {
          const blob = await deps.cloud.assets.get(id)
          if (blob) await deps.cloud.assets.put(id, blob)
        }
        const preview = await deps.localPreview(b)
        if (preview) await deps.cloud.boards.savePreview(userId, made.id, { image: preview.image, nodes: preview.nodes, media: preview.media })
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
  })
}
