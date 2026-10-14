import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { nodesMap } from '../../document/schema'
import type { BoardRecord } from '../types'
import { createImporter, type ImportDeps } from './importLocal'

const rec = (id: string, title: string): BoardRecord => ({ id, ownerId: 'local', title, createdAt: 1, openedAt: 1 })

describe('createImporter', () => {
  it('copies each local board into a new cloud board, with its media and preview', async () => {
    const source = new Y.Doc()
    const node = new Y.Map<unknown>()
    node.set('assetId', 'asset1')
    nodesMap(source).set('n1', node)
    const sourceState = Y.encodeStateAsUpdate(source)

    const pushed: Uint8Array[] = []
    const cloud = {
      boards: { create: vi.fn().mockResolvedValue(rec('cloud1', 'Mine')), savePreview: vi.fn().mockResolvedValue(undefined) },
      persistBoard: (doc: Y.Doc) => {
        pushed.push(Y.encodeStateAsUpdate(doc))
        return { whenSynced: Promise.resolve(), whenServerSynced: Promise.resolve(), destroy: async () => {} }
      },
      assets: { get: vi.fn().mockResolvedValue(new Blob(['x'])), put: vi.fn().mockResolvedValue(undefined) },
    }
    const importer = createImporter({
      localBoards: async () => [rec('default', 'Mine')],
      localPreview: async () => ({ image: null, nodes: 1, media: 1, savedAt: 5 }),
      openLocal: (doc) => {
        Y.applyUpdate(doc, sourceState)
        return { whenSynced: Promise.resolve(), destroy: async () => {} }
      },
      cloud: cloud as unknown as ImportDeps['cloud'],
    })

    expect(await importer.find()).toHaveLength(1)
    expect(await importer.run('u1', await importer.find())).toBe(1)

    expect(cloud.boards.create).toHaveBeenCalledWith('u1', 'Mine')
    const copy = new Y.Doc()
    Y.applyUpdate(copy, pushed[0]!)
    expect(nodesMap(copy).has('n1')).toBe(true)
    expect(cloud.assets.put).toHaveBeenCalledWith('asset1', expect.any(Blob))
    expect(cloud.boards.savePreview).toHaveBeenCalledWith('u1', 'cloud1', { image: null, nodes: 1, media: 1 })
  })
})
