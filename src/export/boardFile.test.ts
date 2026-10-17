import * as Y from 'yjs'
import { describe, expect, it, vi } from 'vitest'
import { addEdge } from '../document/edges'
import { addNode } from '../document/nodes'
import { persistDoc, type Persistence } from '../document/persistence'
import { createDoc, edgesMap, metaMap, nodesMap } from '../document/schema'
import { setEdgeStyle } from '../document/settings'
import {
  BOARD_FILE_FORMAT,
  embeddedBlob,
  importBoardFile,
  parseBoardFile,
  serializeBoard,
} from './boardFile'

/** A board with text, a picture, a link between them and a non-default setting. */
function sampleBoard() {
  const doc = createDoc()
  metaMap(doc).set('title', 'Plans')
  setEdgeStyle(doc, 'elbow')
  const a = addNode(doc, { type: 'text', x: 10, y: 20, w: 200, h: 80, props: { text: 'idea', color: '#ff0', fontSize: 18 } })
  const b = addNode(doc, {
    type: 'image',
    x: 300,
    y: 40,
    w: 160,
    h: 90,
    assetId: 'pic1',
    props: { name: 'dot.png', mime: 'image/png', naturalW: 16, naturalH: 9 },
  })
  addEdge(doc, { from: { nodeId: a }, to: { nodeId: b, locator: { kind: 'rect', x: 1, y: 2, w: 3, h: 4 } }, style: { kind: 'curve', arrow: 'end', color: '#123' } })
  const blobs = new Map([['pic1', new Blob([new Uint8Array([137, 80, 78, 71, 0, 255])], { type: 'image/png' })]])
  return { doc, blobs }
}

const bytes = async (b: Blob) => [...new Uint8Array(await b.arrayBuffer())]

/** The document's contents, with asset ids replaced by what they map to. */
const contents = (doc: Y.Doc) => ({ meta: metaMap(doc).toJSON(), nodes: nodesMap(doc).toJSON(), edges: edgesMap(doc).toJSON() })

describe('board files', () => {
  it('survive JSON and import into a board identical to the original', async () => {
    const { doc, blobs } = sampleBoard()
    const file = parseBoardFile(JSON.stringify(await serializeBoard(doc, 'Plans', async (id) => blobs.get(id) ?? null)))

    const put = new Map<string, Blob>()
    const id = await importBoardFile(file, {
      createBoard: async () => ({ id: 'imported-1' }),
      deleteBoard: vi.fn(),
      persistBoard: persistDoc,
      putAsset: async (assetId, blob) => void put.set(assetId, blob),
      newAssetId: () => 'fresh1',
    })
    expect(id).toBe('imported-1')

    // Opened afresh from storage, as the app will when it navigates there.
    const reopened = new Y.Doc()
    const p = persistDoc(reopened, 'imported-1')
    await p.whenSynced
    const expected = contents(doc)
    for (const n of Object.values(expected.nodes) as Record<string, unknown>[]) if (n.assetId === 'pic1') n.assetId = 'fresh1'
    expect(contents(reopened)).toEqual(expected)
    await p.destroy()

    expect([...put.keys()]).toEqual(['fresh1'])
    expect(await bytes(put.get('fresh1')!)).toEqual(await bytes(blobs.get('pic1')!))
    expect(put.get('fresh1')!.type).toBe('image/png')
  })

  it('leave out media whose bytes are missing', async () => {
    const { doc } = sampleBoard()
    const file = await serializeBoard(doc, 'Plans', async () => null)
    expect(file.files).toEqual({})
    expect(Object.values(file.nodes).some((n) => n.assetId === 'pic1')).toBe(true)
  })

  it('carry large media intact', async () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 251)
    const doc = createDoc()
    addNode(doc, { type: 'video', x: 0, y: 0, w: 10, h: 10, assetId: 'v', props: {} })
    const file = await serializeBoard(doc, 't', async () => new Blob([big], { type: 'video/mp4' }))
    expect(await bytes(embeddedBlob(file.files.v!))).toEqual([...big])
  })

  it('refuse files that are not board files, or are from a newer version', () => {
    expect(() => parseBoardFile('not json')).toThrow('not a board file')
    expect(() => parseBoardFile(JSON.stringify({ hello: 1 }))).toThrow('not a board file')
    const ok = { format: BOARD_FILE_FORMAT, version: 1, schemaVersion: 1, title: 't', meta: {}, nodes: {}, edges: {}, assets: {}, files: {} }
    expect(parseBoardFile(JSON.stringify(ok)).title).toBe('t')
    expect(() => parseBoardFile(JSON.stringify({ ...ok, version: 99 }))).toThrow('newer version')
    expect(() => parseBoardFile(JSON.stringify({ ...ok, nodes: [] }))).toThrow('damaged')
    expect(() => parseBoardFile(JSON.stringify({ ...ok, files: { x: { type: 'a' } } }))).toThrow('damaged')
  })

  it('take the new board away again if its contents cannot be saved', async () => {
    const file = parseBoardFile(JSON.stringify(await serializeBoard(createDoc(), 't', async () => null)))
    const deleteBoard = vi.fn().mockResolvedValue(undefined)
    const failing = (): Persistence => ({ whenSynced: Promise.reject(new Error('disk full')), destroy: async () => {} })
    await expect(
      importBoardFile(file, { createBoard: async () => ({ id: 'b1' }), deleteBoard, persistBoard: failing, putAsset: vi.fn() }),
    ).rejects.toThrow('disk full')
    expect(deleteBoard).toHaveBeenCalledWith('b1')
  })
})
