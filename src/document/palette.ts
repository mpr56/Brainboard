import type * as Y from 'yjs'
import type { Edge, EdgeId, EdgeStyle, Node, NodeId } from '../types'
import { DEFAULT_EDGE_STYLE, listEdges } from './edges'
import { listNodes } from './nodes'

/**
 * Branch colours, in the order a node hands them out.
 *
 * Muted rather than saturated on purpose: a board is mostly connectors once it
 * has any size, and full-strength colour at that coverage competes with the
 * text it is supposed to be organising.
 */
export const BRANCH_PALETTE = [
  '#c96a6a',
  '#5b7fc4',
  '#c8a15e',
  '#6aa17b',
  '#a274b5',
  '#4f9aa8',
  '#c07a4e',
  '#8a8f5c',
] as const

/**
 * The colour every connector was stored with before branch colours existed.
 *
 * Boards from that era are full of it, and because colour is inherited along a
 * branch, a stored black used to be copied onto every new connector grown off
 * an old one — the whole board stayed black forever. It is treated as "no
 * colour chosen" rather than as a real choice.
 */
export const LEGACY_EDGE_COLOR = DEFAULT_EDGE_STYLE.color

const HEX = /^#[0-9a-f]{3,8}$/i

/** A node's own branch colour, set from the colour wheel. Absent means inherit. */
export function nodeColor(node: Pick<Node, 'props'>): string | null {
  const c = node.props.color
  return typeof c === 'string' && HEX.test(c) ? c : null
}

const storedRootColor = (e: Edge): string | null => {
  const c = e.style?.color
  return typeof c === 'string' && HEX.test(c) && c.toLowerCase() !== LEGACY_EDGE_COLOR ? c : null
}

/** A colour the user picked for one connector. Absent means follow the branch. */
export function edgeOwnColor(edge: Pick<Edge, 'color'>): string | null {
  const c = edge.color
  return typeof c === 'string' && HEX.test(c) ? c : null
}

/**
 * The connector each node takes its branch colour from, if any.
 *
 * A node's parent link is the first one to arrive at it — but only if it
 * arrived before the node grew any branches of its own. A node that was
 * already a hub when something was linked into it stays a root: linking into a
 * hub joins two ideas, it does not make the hub part of someone else's branch.
 * Without that, one cross-link repainted every branch of the hub it landed on.
 *
 * It also makes parent links acyclic. Following parents round a loop would
 * need each link to come after the next one in document order, all the way
 * round — which no order can satisfy.
 *
 * Edge order is document order, which is creation order, so every client picks
 * the same parents.
 */
export function parentEdges(edges: Edge[]): Map<NodeId, Edge> {
  const parent = new Map<NodeId, Edge>()
  const branched = new Set<NodeId>()
  for (const e of edges) {
    const to = e.to.nodeId
    if (!parent.has(to) && !branched.has(to)) parent.set(to, e)
    branched.add(e.from.nodeId)
  }
  return parent
}

/**
 * The colour every connector is painted with, resolved from structure.
 *
 * Follows the rule a mind map is read by — a branch keeps one colour all the
 * way out from the trunk — with the colour wheel as the way to break it:
 *
 *   1. A connector given a colour of its own (clicked and recoloured) takes it.
 *   2. A connector arriving at a node that has its own colour takes that
 *      colour. Recolouring a node recolours the branch that leads into it.
 *   3. Otherwise it takes its source's colour: the source's own, or the colour
 *      of the source's parent link (see `parentEdges`). So a recolour flows
 *      downstream until another colour choice takes over.
 *   4. Connectors leaving a root — a node with no parent link — fall back to
 *      what was stored on the connector when it was drawn, which is how a
 *      root's branches keep distinct palette colours.
 *
 * Resolved at paint time rather than read off each edge, because a stored
 * colour cannot follow a recolour upstream, and because stored colours on old
 * boards are the legacy black (see LEGACY_EDGE_COLOR).
 *
 * Pure: same nodes and edges in, same colours out, on every client.
 */
export function resolveEdgeColors(nodes: Node[], edges: Edge[]): Map<EdgeId, string> {
  const own = new Map<NodeId, string>()
  for (const n of nodes) {
    const c = nodeColor(n)
    if (c) own.set(n.id, c)
  }

  const parent = parentEdges(edges)
  const rootIndex = new Map<EdgeId, number>()
  const outCount = new Map<NodeId, number>()
  for (const e of edges) {
    const i = outCount.get(e.from.nodeId) ?? 0
    rootIndex.set(e.id, i)
    outCount.set(e.from.nodeId, i + 1)
  }

  const fallback = (e: Edge) =>
    storedRootColor(e) ?? BRANCH_PALETTE[(rootIndex.get(e.id) ?? 0) % BRANCH_PALETTE.length]!

  const memo = new Map<EdgeId, string>()
  // Parent links cannot form a loop (see parentEdges), so this guard should
  // never trip. It stays because the cost of being wrong is a stack overflow
  // inside render.
  const resolving = new Set<EdgeId>()

  const sourceColor = (id: NodeId): string | null => {
    const c = own.get(id)
    if (c) return c
    const arrived = parent.get(id)
    return arrived ? edgeColor(arrived) : null
  }

  const edgeColor = (e: Edge): string => {
    const hit = memo.get(e.id)
    if (hit) return hit
    if (resolving.has(e.id)) return fallback(e)
    resolving.add(e.id)
    const c =
      edgeOwnColor(e) ?? own.get(e.to.nodeId) ?? sourceColor(e.from.nodeId) ?? fallback(e)
    resolving.delete(e.id)
    memo.set(e.id, c)
    return c
  }

  const out = new Map<EdgeId, string>()
  for (const e of edges) out.set(e.id, edgeColor(e))
  return out
}

/**
 * The colour each node is drawn in: its own, or the colour of its parent link.
 *
 * A root with no colour of its own is left out. Its branches are all
 * different colours, so there is no one colour it could honestly wear.
 */
export function resolveNodeColors(
  nodes: Node[],
  edges: Edge[],
  edgeColors: Map<EdgeId, string>,
): Map<NodeId, string> {
  const parent = parentEdges(edges)
  const out = new Map<NodeId, string>()
  for (const n of nodes) {
    const arrived = parent.get(n.id)
    const c = nodeColor(n) ?? (arrived ? edgeColors.get(arrived.id) : undefined)
    if (c) out.set(n.id, c)
  }
  return out
}

/**
 * The colour a new connector leaving `fromNodeId` should take — what
 * `resolveEdgeColors` would paint it once it exists, so the stored value and
 * the painted one agree.
 *
 * A source with a colour of its own, or with a parent link, passes that colour
 * on. A root starts a new colour, cycling the palette so its own branches stay
 * distinct.
 *
 * Deterministic from document state rather than from a counter, so two clients
 * creating edges independently pick the same colours for the same structure.
 */
export function branchColor(doc: Y.Doc, fromNodeId: NodeId): string {
  const nodes = listNodes(doc)
  const edges = listEdges(doc)

  const source = nodes.find((n) => n.id === fromNodeId)
  const own = source ? nodeColor(source) : null
  if (own) return own

  const arrived = parentEdges(edges).get(fromNodeId)
  if (arrived) return resolveEdgeColors(nodes, edges).get(arrived.id)!

  const outgoing = edges.filter((e) => e.from.nodeId === fromNodeId).length
  return BRANCH_PALETTE[outgoing % BRANCH_PALETTE.length]!
}

/** The full style a newly drawn connector gets: chosen routing, branch colour. */
export function branchEdgeStyle(
  doc: Y.Doc,
  fromNodeId: NodeId,
  kind: EdgeStyle['kind'],
): Partial<EdgeStyle> {
  return { kind, color: branchColor(doc, fromNodeId) }
}

/**
 * `hex` mixed into the card colour by `amount` (0..1), as a hex string — the
 * faint wash a coloured node's card gets. Computed rather than left to CSS
 * `color-mix` so export, which paints to a canvas, gets the identical colour.
 */
export function tint(hex: string, amount: number, base = '#fdfcf9'): string {
  const rgb = (h: string) => {
    const s = h.replace('#', '')
    const full = s.length === 3 ? s.replace(/./g, (c) => c + c) : s.slice(0, 6)
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  }
  const a = rgb(hex)
  const b = rgb(base)
  return (
    '#' +
    a
      .map((v, i) => Math.round(b[i]! + (v - b[i]!) * amount))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  )
}
