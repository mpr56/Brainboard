import * as Y from 'yjs'
import { nanoid } from 'nanoid'
import type { Anchor, Edge, EdgeId, EdgeStyle, NodeId } from '../types'
import { edgesMap, transact, type Origin } from './schema'

export const DEFAULT_EDGE_STYLE: EdgeStyle = { kind: 'curve', arrow: 'end', color: '#1a1a1a' }

export type EdgeInit = {
  id?: EdgeId
  from: Anchor
  to: Anchor
  label?: string
  style?: Partial<EdgeStyle>
}

const isAnchor = (v: unknown): v is Anchor =>
  typeof v === 'object' && v !== null && typeof (v as Anchor).nodeId === 'string'

/**
 * Check that a Y.Map carries the structure every reader dereferences. A row
 * that arrived from IndexedDB (a partially committed write, a future schema
 * change) can be missing `from` entirely; without this, `toEdge` hands back
 * `{from: undefined}` and the first `edge.from.nodeId` throws — inside
 * ConnectorLayer's render, which white-screens the whole board. Spec §9:
 * corrupt state must surface, not propagate silently. Mirrors `isValidNode`.
 */
function isValidEdge(m: Y.Map<unknown>): boolean {
  const style = m.get('style')
  return (
    isAnchor(m.get('from')) &&
    isAnchor(m.get('to')) &&
    typeof style === 'object' &&
    style !== null
  )
}

/**
 * Callers hand us their own objects. Stored by reference, a later mutation of
 * one would change document state outside any transaction — invisible to
 * observers and to undo. Clone on the way in.
 */
const cloneAnchor = (a: Anchor): Anchor =>
  a.locator ? { nodeId: a.nodeId, locator: { ...a.locator } } : { nodeId: a.nodeId }

function toEdge(id: EdgeId, m: Y.Map<unknown>): Edge {
  return {
    id,
    from: m.get('from') as Anchor,
    to: m.get('to') as Anchor,
    label: m.get('label') as string | undefined,
    style: m.get('style') as EdgeStyle,
    color: m.get('color') as string | undefined,
  }
}

export function addEdge(doc: Y.Doc, init: EdgeInit, origin: Origin = 'user'): EdgeId {
  const id = init.id ?? nanoid()
  transact(doc, origin, () => {
    const m = new Y.Map<unknown>()
    m.set('from', cloneAnchor(init.from))
    m.set('to', cloneAnchor(init.to))
    if (init.label !== undefined) m.set('label', init.label)
    m.set('style', { ...DEFAULT_EDGE_STYLE, ...init.style })
    edgesMap(doc).set(id, m)
  })
  return id
}

export function getEdge(doc: Y.Doc, id: EdgeId): Edge | null {
  const m = edgesMap(doc).get(id)
  return m && isValidEdge(m) ? toEdge(id, m) : null
}

export function listEdges(doc: Y.Doc): Edge[] {
  const out: Edge[] = []
  edgesMap(doc).forEach((m, id) => {
    if (isValidEdge(m)) out.push(toEdge(id, m))
  })
  return out
}

export function edgesTouching(doc: Y.Doc, nodeId: NodeId): Edge[] {
  return listEdges(doc).filter((e) => e.from.nodeId === nodeId || e.to.nodeId === nodeId)
}

export function updateEdge(
  doc: Y.Doc,
  id: EdgeId,
  patch: Partial<Omit<Edge, 'id'>>,
  origin: Origin = 'user',
): void {
  const m = edgesMap(doc).get(id)
  if (!m) return
  transact(doc, origin, () => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      if (key === 'from' || key === 'to') m.set(key, cloneAnchor(value as Anchor))
      else if (key === 'style') m.set(key, { ...(value as EdgeStyle) })
      else m.set(key, value)
    }
  })
}

export function removeEdge(doc: Y.Doc, id: EdgeId, origin: Origin = 'user'): void {
  transact(doc, origin, () => {
    edgesMap(doc).delete(id)
  })
}

/**
 * Sets or clears the colour picked for one connector. Separate from
 * `updateEdge`, which skips undefined values and so has no way to clear one.
 */
export function setEdgeColor(
  doc: Y.Doc,
  id: EdgeId,
  color: string | null,
  origin: Origin = 'user',
): void {
  const m = edgesMap(doc).get(id)
  if (!m) return
  transact(doc, origin, () => {
    if (color) m.set('color', color)
    else m.delete('color')
  })
}
