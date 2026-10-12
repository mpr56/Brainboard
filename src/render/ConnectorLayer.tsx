import { routeFor } from '../geometry/edgeRoute'
import { connectorPath } from '../geometry/ribbon'
import type { Edge, EdgeId, EdgeStyleKind, Node, NodeId } from '../types'

type Props = {
  edges: Edge[]
  nodesById: Map<NodeId, Node>
  /**
   * Each connector's colour, resolved from branch structure and node colours by
   * `resolveEdgeColors`. An edge missing from it paints with what it stored.
   */
  colors?: Map<EdgeId, string>
  /**
   * The board's routing style. It applies to every connector at once, so the
   * toolbar switch restyles the whole board rather than only edges drawn
   * after it. An edge's stored `style.kind` is used only when this is absent.
   */
  kind?: EdgeStyleKind
  /** The link clicked on, outlined so it is clear which one the menu acts on. */
  selectedEdgeId?: EdgeId | null
}

/**
 * Connectors are painted as filled shapes: tapered ribbons, wide where they
 * leave their source and narrow where they arrive — or, in the `arrow` style,
 * a thin line with a small head.
 *
 * On the ribbon styles the taper is what carries direction, which is why they
 * have no arrowheads. A marker cannot be made to taper, and a uniform stroke
 * with an arrow on the end reads as a diagram edge rather than a branch — the
 * shape itself says which way the link runs, at any zoom and without a second
 * element to occlude. The arrow style is there for when a diagram edge is
 * what you want.
 *
 * `style.arrow` is still stored on every edge and is not read: the arrow is a
 * board-wide style (see document/settings.ts), not a per-edge flag.
 *
 * Nothing here takes pointer events. Links are picked geometrically by
 * `pickEdge`, because the hover halo round each node sits above this layer.
 */
export function ConnectorLayer({ edges, nodesById, colors, kind, selectedEdgeId }: Props) {
  return (
    <svg
      data-testid="connector-layer"
      style={{ position: 'absolute', overflow: 'visible', pointerEvents: 'none', left: 0, top: 0 }}
    >
      {edges.map((edge) => {
        // `document/edges.ts` already filters structurally-invalid rows out of
        // every read, and routeFor checks again. The cost of being wrong is
        // asymmetric: dereferencing a missing anchor here throws during
        // render, which unmounts the whole board, while skipping one
        // unpaintable edge loses one line.
        const route = routeFor(edge, nodesById, kind)
        if (!route) return null
        const d = connectorPath(route.points, route.kind)
        if (!d) return null
        const fill = colors?.get(edge.id) ?? edge.style.color
        const selected = edge.id === selectedEdgeId

        return (
          <g key={edge.id}>
            {selected && (
              <path
                data-testid={`edge-selected-${edge.id}`}
                d={d}
                fill="none"
                stroke="#2d63d6"
                strokeWidth={6}
                strokeLinejoin="round"
                opacity={0.35}
              />
            )}
            <path
              data-testid={`edge-${edge.id}`}
              data-edge-id={edge.id}
              data-edge-style={route.kind}
              data-selected={selected ? 'true' : undefined}
              d={d}
              fill={fill}
              stroke="none"
            />
          </g>
        )
      })}
    </svg>
  )
}
