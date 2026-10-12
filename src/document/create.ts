import type * as Y from 'yjs'
import type { Anchor, EdgeStyleKind, NodeId, Point } from '../types'
import { addEdge } from './edges'
import { addNode } from './nodes'
import { branchEdgeStyle } from './palette'
import { transact, type Origin } from './schema'

/**
 * The prompt an empty node shows. A placeholder, not content: new nodes are
 * created with no text, so typing replaces the prompt instead of being added
 * after it.
 */
export const NEW_NODE_TEXT = 'New idea'

export type CreateNodeOptions = {
  /**
   * Size of the new node. Passed in rather than read here: node sizing is a
   * view concern owned by the type registry, and the document layer must not
   * depend on `render/`.
   */
  size: { w: number; h: number }
  text?: string
  /** When set, an edge is drawn from this anchor to the new node. */
  from?: Anchor
  edgeStyleKind?: EdgeStyleKind
}

/**
 * Creates a text node centred on `at`, optionally linked from an existing
 * anchor, as exactly ONE undo step.
 *
 * The single transaction is the whole point. `addNode` and `addEdge` each open
 * one of their own, and run back to back they produce two undo entries — so
 * spawning a child off a handle would take two presses of Cmd-Z, and the first
 * would leave a dangling edge on screen. Yjs transactions nest rather than
 * stack, so wrapping both here collapses them into one entry without either
 * function having to know it is being called from inside another.
 *
 * The point is the new node's *centre*, not its corner: every caller knows
 * where the node should appear (under the pointer, off a parent's side), not
 * where its top-left should land.
 */
export function createNodeAt(
  doc: Y.Doc,
  at: Point,
  opts: CreateNodeOptions,
  origin: Origin = 'user',
): NodeId {
  const { size, text = '', from, edgeStyleKind = 'curve' } = opts

  let id!: NodeId
  transact(doc, origin, () => {
    id = addNode(
      doc,
      {
        type: 'text',
        x: at.x - size.w / 2,
        y: at.y - size.h / 2,
        w: size.w,
        h: size.h,
        props: { text },
      },
      origin,
    )
    if (from) {
      addEdge(
        doc,
        { from, to: { nodeId: id }, style: branchEdgeStyle(doc, from.nodeId, edgeStyleKind) },
        origin,
      )
    }
  })
  return id
}
