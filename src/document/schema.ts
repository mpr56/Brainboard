import * as Y from 'yjs'

export type Origin = 'user' | 'system'

export const SCHEMA_VERSION = 1

/**
 * `seed: false` leaves the document empty, for one about to load saved state:
 * defaults written first would conflict with the saved values of the same
 * keys, and Yjs settles that by client id, so either side could win.
 */
export function createDoc(seed = true): Y.Doc {
  const doc = new Y.Doc()
  if (seed) seedMeta(doc)
  return doc
}

/** Gives a document that has none the board's default settings. */
export function seedMeta(doc: Y.Doc): void {
  const meta = metaMap(doc)
  if (!meta.has('schemaVersion')) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION)
      meta.set('createdAt', Date.now())
      meta.set('title', 'Untitled board')
    }, 'system' satisfies Origin)
  }
}

export const metaMap = (doc: Y.Doc) => doc.getMap<unknown>('meta')
export const nodesMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('nodes')
export const edgesMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('edges')
export const assetsMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('assets')

/** Runs `fn` as a single undo step attributed to `origin`. */
export function transact(doc: Y.Doc, origin: Origin, fn: () => void): void {
  doc.transact(fn, origin)
}
