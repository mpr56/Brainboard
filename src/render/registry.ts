import type { FC } from 'react'
import type { Node } from '../types'

export type NodeViewState = { selected: boolean; editing: boolean }

export type NodeViewProps = {
  node: Node
  state: NodeViewState
  /** Commit a user-intent change (undoable). */
  onEdit: (patch: Partial<Node>) => void
  /**
   * Report the laid-out size so the document stays the source of truth
   * (rule 1). Width matters only for views that size themselves to their
   * content; the rest report the width they were given.
   */
  onMeasure: (size: { w: number; h: number }) => void
  /**
   * Signal that this node's edit session has genuinely ended (the view lost
   * focus). Without it nothing upstream can clear `editingId`, so the node
   * stays contentEditable forever and the keyboard stays in "typing" mode.
   */
  onEndEdit: () => void
}

export type NodeTypeDef = {
  type: string
  /** Rule 6: types that must stay in the DOM under any future renderer. */
  domOnly: boolean
  defaultSize: () => { w: number; h: number }
  View: FC<NodeViewProps>
  /**
   * Whether a double-click opens the node (typing into text, reading a PDF).
   * Pictures and players have nothing to open.
   */
  editable?: boolean
  /** Whether the node gets a corner handle to resize it. */
  resizable?: boolean
  /** Whether resizing keeps the node's proportions (a picture's, say). */
  keepAspect?: boolean
  /**
   * Drawn with no card — no border, background or shadow — so the view is the
   * whole node. Media is: a picture should look like a picture on the board,
   * not a picture in a box.
   */
  frameless?: boolean
}

const registry = new Map<string, NodeTypeDef>()

export function registerNodeType(def: NodeTypeDef): void {
  registry.set(def.type, def)
}

export function getNodeType(type: string): NodeTypeDef {
  return registry.get(type) ?? registry.get('text')!
}

export function listNodeTypes(): NodeTypeDef[] {
  return [...registry.values()]
}

import { MEDIA_NODE_TYPES } from './nodes/MediaNode'
import { TEXT_NODE_TYPE } from './nodes/TextNode'

const BUILT_IN = [TEXT_NODE_TYPE, ...MEDIA_NODE_TYPES]
for (const def of BUILT_IN) registerNodeType(def)

export function resetRegistry(): void {
  registry.clear()
  for (const def of BUILT_IN) registerNodeType(def)
}
