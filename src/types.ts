export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }

/**
 * A side of a node. Names the direction a spawn handle points, which is also
 * the direction the child node it creates ends up in.
 *
 * Lives here rather than in `tools/` because both geometry and rendering need
 * it and neither may depend on the tool layer.
 */
export type Dir = 'n' | 'e' | 's' | 'w'

export type NodeId = string
export type EdgeId = string
export type AssetId = string

export type Locator =
  | { kind: 'time'; t: number; dur?: number }
  | { kind: 'page'; n: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'text'; from: number; to: number }

export type Anchor = { nodeId: NodeId; locator?: Locator }

export type Node = {
  id: NodeId
  type: string
  x: number
  y: number
  w: number
  h: number
  z: number
  parent: NodeId | null
  assetId?: AssetId
  props: Record<string, unknown>
}

/**
 * How a connector is routed and painted. `arrow` routes exactly like `curve`
 * but is painted as a thin line with a small arrowhead instead of a taper.
 */
export type EdgeStyleKind = 'curve' | 'arrow' | 'elbow' | 'straight'

export type EdgeStyle = {
  kind: EdgeStyleKind
  arrow: 'none' | 'end' | 'both'
  color: string
}

export type Edge = {
  id: EdgeId
  from: Anchor
  to: Anchor
  label?: string
  style: EdgeStyle
  /**
   * A colour picked for this one connector. Unlike `style.color` (what the
   * connector was drawn with), this always wins when painting.
   */
  color?: string
}

/** Metadata a node's asset carries; Plan 2 fills this in. */
export type AssetMeta = {
  width?: number
  height?: number
  duration?: number
  pages?: number
}
