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
      progress: { get: () => undefined, set: () => {} },
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

describe('createImporter, when the server does not cooperate', () => {
  const memoryProgress = (): ImportDeps['progress'] => {
    const m = new Map<string, { cloudId: string; done: boolean }>()
    return { get: (id) => m.get(id), set: (id, e) => void m.set(id, e) }
  }
  const openEmpty: ImportDeps['openLocal'] = () => ({ whenSynced: Promise.resolve(), destroy: async () => {} })
  const noPreview = async () => null

  function cloud(serverSyncs: (cloudId: string) => boolean) {
    let n = 0
    return {
      boards: {
        create: vi.fn(async (_u: string, title: string) => rec(`cloud${++n}`, title)),
        savePreview: vi.fn().mockResolvedValue(undefined),
      },
      persistBoard: vi.fn((_doc: Y.Doc, cloudId: string) => ({
        whenSynced: Promise.resolve(),
        whenServerSynced: serverSyncs(cloudId) ? Promise.resolve() : new Promise<void>(() => {}),
        destroy: async () => {},
      })),
      assets: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
    }
  }

  it('gives up on a board the server never confirms, instead of hanging', async () => {
    const importer = createImporter({
      localBoards: async () => [rec('a', 'A')],
      localPreview: noPreview,
      openLocal: openEmpty,
      cloud: cloud(() => false) as unknown as ImportDeps['cloud'],
      progress: memoryProgress(),
      serverWaitMs: 30,
    })
    await expect(importer.run('u', [rec('a', 'A')])).rejects.toThrow(/server/i)
  })

  it('resumes into the board it already made, and skips boards already copied', async () => {
    const progress = memoryProgress()
    let serverUp = false
    const c = cloud((id) => id === 'cloud1' || serverUp)
    const importer = createImporter({
      localBoards: async () => [rec('a', 'A'), rec('b', 'B')],
      localPreview: noPreview,
      openLocal: openEmpty,
      cloud: c as unknown as ImportDeps['cloud'],
      progress,
      serverWaitMs: 30,
    })

    await expect(importer.run('u', await importer.find())).rejects.toThrow()
    expect(c.boards.create).toHaveBeenCalledTimes(2) // a → cloud1 done, b → cloud2 stuck

    serverUp = true
    const left = await importer.find()
    expect(left.map((b) => b.id)).toEqual(['b'])
    expect(await importer.run('u', left)).toBe(1)
    expect(c.boards.create).toHaveBeenCalledTimes(2) // no third board
    expect(c.persistBoard).toHaveBeenLastCalledWith(expect.anything(), 'cloud2')
    expect(await importer.find()).toEqual([])
  })
})
