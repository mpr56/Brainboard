import type * as Y from 'yjs'
import type { Anchor, Dir, EdgeStyleKind, Node, NodeId, Point, Rect } from '../types'

export type Part = 'body' | 'edge' | 'handle' | 'scrubber' | 'resize'

/**
 * `dir` is set only for parts that have a side — today that means spawn
 * handles. It is what tells a click on a handle which way to put the node it
 * creates.
 */
export type Hit = { nodeId: NodeId; part: Part; dir?: Dir }

export type Modifiers = { shift: boolean; meta: boolean; alt: boolean; space: boolean }

/** Rule 3: tools never see DOM events — only this. */
export type WorldEvent = {
  type: 'down' | 'move' | 'up'
  worldPoint: Point
  screenPoint: Point
  hit: Hit | null
  modifiers: Modifiers
}

export type ToolContext = {
  doc: Y.Doc
  nodes: Node[]
  selection: Set<NodeId>
  setSelection: (s: Set<NodeId>) => void
  marquee: Rect | null
  setMarquee: (r: Rect | null) => void
  /** The routing style a newly drawn connector is created with (DoD 3). */
  edgeStyleKind: EdgeStyleKind
  /**
   * Size a new node will be given, so a tool can work out where to put one
   * without reaching into the node-type registry. Tools stay free of `render/`
   * the same way rule 3 keeps them free of the DOM.
   */
  newNodeSize: { w: number; h: number }
  /**
   * Creates a text node centred on `at`, optionally linked from `from`, as one
   * undo step, and hands it to the user ready to type into.
   *
   * Supplied by the composition root rather than called directly so that node
   * *creation policy* — what gets selected, what opens for editing — stays in
   * one place instead of being duplicated across every tool that can make one.
   */
  createNode: (at: Point, from?: Anchor) => NodeId
}

export type Tool = {
  name: string
  onDown?: (e: WorldEvent, ctx: ToolContext) => void
  onMove?: (e: WorldEvent, ctx: ToolContext) => void
  onUp?: (e: WorldEvent, ctx: ToolContext) => void
}
