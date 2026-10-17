import { nanoid } from 'nanoid'
import * as Y from 'yjs'
import type { Persistence } from '../document/persistence'
import { SCHEMA_VERSION, assetsMap, edgesMap, metaMap, nodesMap, transact } from '../document/schema'
import type { AssetId } from '../types'

export const BOARD_FILE_FORMAT = 'brainboard/board'
export const BOARD_FILE_VERSION = 1
export const BOARD_FILE_EXTENSION = '.brainboard.json'

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
type Rows = Record<string, Record<string, Json>>

/** A media file's bytes, carried inside the board file so it needs nothing else. */
export type EmbeddedFile = { type: string; base64: string }

/**
 * A whole board as one JSON file: the document's maps exactly as stored —
 * every node and edge under its own id, every key it has, the board's
 * settings in `meta` — plus the bytes of every media file a node points at.
 *
 * Copied key by key rather than through the app's Node and Edge types, so
 * whatever a later version adds to a row survives an export and import made
 * by this one.
 */
export type BoardFile = {
  format: typeof BOARD_FILE_FORMAT
  version: number
  schemaVersion: number
  exportedAt: number
  title: string
  meta: Record<string, Json>
  nodes: Rows
  edges: Rows
  assets: Rows
  files: Record<AssetId, EmbeddedFile>
}

const rows = (map: Y.Map<Y.Map<unknown>>): Rows => map.toJSON() as Rows

function referencedAssets(doc: Y.Doc): AssetId[] {
  const ids = new Set<AssetId>()
  nodesMap(doc).forEach((m) => {
    const id = m.get('assetId')
    if (typeof id === 'string') ids.add(id)
  })
  return [...ids]
}

/** Chunked, because spreading a large array into String.fromCharCode overflows the stack. */
function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const s = atob(base64)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return bytes
}

/**
 * Captures the board. A media file whose bytes are missing — a board copied
 * without its media store — is left out, and its node shows as missing after
 * import just as it does now.
 */
export async function serializeBoard(
  doc: Y.Doc,
  title: string,
  getBlob: (id: AssetId) => Promise<Blob | null>,
  now = Date.now(),
): Promise<BoardFile> {
  const files: Record<AssetId, EmbeddedFile> = {}
  for (const id of referencedAssets(doc)) {
    const blob = await getBlob(id).catch(() => null)
    if (blob) files[id] = { type: blob.type, base64: toBase64(new Uint8Array(await blob.arrayBuffer())) }
  }
  const meta = metaMap(doc).toJSON() as Record<string, Json>
  return {
    format: BOARD_FILE_FORMAT,
    version: BOARD_FILE_VERSION,
    schemaVersion: typeof meta.schemaVersion === 'number' ? meta.schemaVersion : SCHEMA_VERSION,
    exportedAt: now,
    title,
    meta,
    nodes: rows(nodesMap(doc)),
    edges: rows(edgesMap(doc)),
    assets: rows(assetsMap(doc)),
    files,
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isRows = (v: unknown): v is Rows => isObject(v) && Object.values(v).every(isObject)

/** Reads a board file, refusing anything that is not one this version can load. */
export function parseBoardFile(text: string): BoardFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('That file is not a board file.')
  }
  if (!isObject(raw) || raw.format !== BOARD_FILE_FORMAT) throw new Error('That file is not a board file.')
  if (typeof raw.version !== 'number' || raw.version > BOARD_FILE_VERSION) {
    throw new Error('That board file was made by a newer version of the app.')
  }
  if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > SCHEMA_VERSION) {
    throw new Error('That board file was made by a newer version of the app.')
  }
  const files = raw.files ?? {}
  const filesOk =
    isObject(files) &&
    Object.values(files).every((f) => isObject(f) && typeof f.type === 'string' && typeof f.base64 === 'string')
  if (!isRows(raw.nodes) || !isRows(raw.edges) || !isRows(raw.assets ?? {}) || !isObject(raw.meta ?? {}) || !filesOk) {
    throw new Error('That board file is damaged.')
  }
  return {
    format: BOARD_FILE_FORMAT,
    version: raw.version,
    schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : SCHEMA_VERSION,
    exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : 'Imported board',
    meta: (raw.meta ?? {}) as Record<string, Json>,
    nodes: raw.nodes,
    edges: raw.edges,
    assets: (raw.assets ?? {}) as Rows,
    files: files as Record<AssetId, EmbeddedFile>,
  }
}

/** The bytes of each embedded file, as a Blob of its own type. */
export function embeddedBlob(file: EmbeddedFile): Blob {
  return new Blob([fromBase64(file.base64)], { type: file.type })
}

/**
 * Writes the file's contents into `doc`, in one transaction. Node and edge ids
 * are kept — they only have to be unique within a board — but asset ids are
 * swapped through `assetIds`: on the server an asset id belongs to the
 * account that first wrote it, so reusing the exported ones would fail for
 * anyone else, and for the same account importing a file twice.
 */
export function populateDoc(doc: Y.Doc, file: BoardFile, assetIds: ReadonlyMap<AssetId, AssetId>): void {
  const swap = (id: unknown) => (typeof id === 'string' ? (assetIds.get(id) ?? id) : id)
  const fill = (map: Y.Map<Y.Map<unknown>>, source: Rows, rename = false) => {
    for (const [id, row] of Object.entries(source)) {
      const m = new Y.Map<unknown>()
      for (const [k, v] of Object.entries(row)) m.set(k, k === 'assetId' ? swap(v) : v)
      map.set(rename ? (swap(id) as string) : id, m)
    }
  }
  transact(doc, 'system', () => {
    const meta = metaMap(doc)
    for (const [k, v] of Object.entries(file.meta)) meta.set(k, v)
    fill(nodesMap(doc), file.nodes)
    fill(edgesMap(doc), file.edges)
    fill(assetsMap(doc), file.assets, true)
  })
}

export type ImportDeps = {
  /** Makes the empty board the file is loaded into. */
  createBoard: (title: string) => Promise<{ id: string }>
  /** Takes the new board away again if its contents could not be saved. */
  deleteBoard: (boardId: string) => Promise<void>
  persistBoard: (doc: Y.Doc, boardId: string) => Persistence
  putAsset: (id: AssetId, blob: Blob) => Promise<void>
  newAssetId?: () => AssetId
}

/**
 * Makes a new board holding the file's contents and returns its id.
 *
 * Media goes in first, so the board never points at a file that is not there
 * yet. The contents are saved to this browser's copy of the board; with the
 * cloud backend they reach the server when the board is opened, as any
 * offline edit would.
 */
export async function importBoardFile(file: BoardFile, deps: ImportDeps): Promise<string> {
  const newId = deps.newAssetId ?? (() => nanoid())
  const assetIds = new Map<AssetId, AssetId>()
  for (const [oldId, embedded] of Object.entries(file.files)) {
    const id = newId()
    await deps.putAsset(id, embeddedBlob(embedded))
    assetIds.set(oldId, id)
  }

  const board = await deps.createBoard(file.title)
  const doc = new Y.Doc()
  try {
    populateDoc(doc, file, assetIds)
    const persistence = deps.persistBoard(doc, board.id)
    try {
      await persistence.whenSynced
    } finally {
      await persistence.destroy()
    }
  } catch (err) {
    // No half-filled board left behind on home.
    await deps.deleteBoard(board.id).catch(() => {})
    throw err
  } finally {
    doc.destroy()
  }
  return board.id
}
