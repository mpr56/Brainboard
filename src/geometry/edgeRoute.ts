import type { Edge, EdgeId, EdgeStyleKind, Node, NodeId, Point } from '../types'
import { nodePort } from './anchors'
import { sampleCenterline } from './ribbon'
import { routeEdge } from './routeEdge'

export type EdgeRoute = { id: EdgeId; points: Point[]; kind: EdgeStyleKind }

/**
 * Where a committed connector runs, in world units — the one routing every
 * painter and the edge picker share, so what you click is what was drawn.
 *
 * Each end picks its side from the two *boxes*, never from the other end's
 * result, so the same pair of nodes routes identically whichever way the edge
 * points. Returns null for an edge that cannot be painted (a missing node, a
 * malformed row).
 */
export function routeFor(
  edge: Edge,
  nodesById: Map<NodeId, Node>,
  kind?: EdgeStyleKind,
): EdgeRoute | null {
  if (!edge.from || !edge.to || !edge.style) return null
  const from = nodesById.get(edge.from.nodeId)
  const to = nodesById.get(edge.to.nodeId)
  if (!from || !to) return null
  const a = nodePort(from, to, edge.from.locator)
  const b = nodePort(to, from, edge.to.locator)
  const style = kind ?? edge.style.kind
  return { id: edge.id, points: routeEdge(a.point, b.point, style, a.side, b.side).points, kind: style }
}

/** The point halfway along a route's centreline — where a link's menu opens. */
export function routeMidpoint(route: Pick<EdgeRoute, 'points' | 'kind'>): Point {
  const s = sampleCenterline(route.points, route.kind, 2)
  return s[1] ?? route.points[0] ?? { x: 0, y: 0 }
}

const PICK_SAMPLES = 48

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

/**
 * The connector whose centreline passes nearest `p`, if any is within
 * `tolerance` world units.
 *
 * Geometric rather than a DOM hit test on purpose: connectors are drawn under
 * the nodes, and the hover halo round each node covers the first stretch of
 * every link, so the DOM would report "node halo" for a click that was plainly
 * on the line. This is also the shape rule 3 asks hit-testing to take — a pure
 * query a canvas renderer could keep unchanged.
 */
export function pickEdge(routes: EdgeRoute[], p: Point, tolerance: number): EdgeId | null {
  let best: EdgeId | null = null
  let bestD = tolerance
  for (const r of routes) {
    const s = sampleCenterline(r.points, r.kind, PICK_SAMPLES)
    for (let i = 1; i < s.length; i++) {
      const d = distToSegment(p, s[i - 1]!, s[i]!)
      if (d <= bestD) {
        bestD = d
        best = r.id
      }
    }
  }
  return best
}
