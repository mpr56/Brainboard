import { getNode, updateNode } from '../document/nodes'
import type { NodeId, Point, Rect } from '../types'
import { pastDragThreshold } from './gesture'
import type { Tool, ToolContext, WorldEvent } from './types'

/** Smallest a resized node may get, in world units. */
export const MIN_RESIZE = 60

type ResizeState = {
  id: NodeId
  start: Rect
  origin: Point
  screenOrigin: Point
  current: Point
  /** Width over height to hold, or null to resize freely. */
  aspect: number | null
  moved: boolean
}

/** The in-flight size of the node being resized, for the view to paint. */
export type ResizePreview = { id: NodeId; w: number; h: number }

// Like a drag, nothing is written until pointer-up: one gesture, one undo step.
let state: ResizeState | null = null

export function resetResizeTool(): void {
  state = null
}

/**
 * The size a corner drag gives a node: its starting size plus the pointer's
 * travel, held to the node's proportions when it has them, never below
 * MIN_RESIZE on either side. With proportions held, whichever axis the pointer
 * moved further along wins, so the corner tracks the pointer.
 */
export function resizedSize(start: Rect, dx: number, dy: number, aspect: number | null): { w: number; h: number } {
  let w = start.w + dx
  let h = start.h + dy
  if (aspect) {
    if (Math.abs(dx) * (start.h / start.w) >= Math.abs(dy)) h = w / aspect
    else w = h * aspect
    // Dragged past the opposite corner, w and h go negative; either way the
    // smallest the node can be is its short side at the minimum.
    if (w < MIN_RESIZE || h < MIN_RESIZE) {
      if (aspect >= 1) {
        h = MIN_RESIZE
        w = MIN_RESIZE * aspect
      } else {
        w = MIN_RESIZE
        h = MIN_RESIZE / aspect
      }
    }
  } else {
    w = Math.max(MIN_RESIZE, w)
    h = Math.max(MIN_RESIZE, h)
  }
  return { w: Math.round(w), h: Math.round(h) }
}

export function resizePreview(): ResizePreview | null {
  if (!state || !state.moved) return null
  const { w, h } = resizedSize(
    state.start,
    state.current.x - state.origin.x,
    state.current.y - state.origin.y,
    state.aspect,
  )
  return { id: state.id, w, h }
}

/**
 * Resizing a node from its bottom-right corner handle. App routes a gesture
 * here when it starts on a node's `resize` part.
 *
 * `keepAspect` is read through the context rather than from the registry, so
 * tools stay free of `render/` the way rule 3 keeps them free of the DOM.
 */
export function createResizeTool(keepAspect: (id: NodeId) => boolean): Tool {
  return {
    name: 'resize',

    onDown(e: WorldEvent, ctx: ToolContext) {
      state = null
      if (!e.hit) return
      const node = getNode(ctx.doc, e.hit.nodeId)
      if (!node) return
      ctx.setSelection(new Set([node.id]))
      state = {
        id: node.id,
        start: { x: node.x, y: node.y, w: node.w, h: node.h },
        origin: e.worldPoint,
        screenOrigin: e.screenPoint,
        current: e.worldPoint,
        aspect: keepAspect(node.id) && node.h > 0 ? node.w / node.h : null,
        moved: false,
      }
    },

    onMove(e: WorldEvent) {
      if (!state) return
      state.current = e.worldPoint
      if (!state.moved && pastDragThreshold(state.screenOrigin, e.screenPoint)) state.moved = true
    },

    onUp(e: WorldEvent, ctx: ToolContext) {
      const s = state
      state = null
      if (!s || !s.moved) return
      const size = resizedSize(s.start, e.worldPoint.x - s.origin.x, e.worldPoint.y - s.origin.y, s.aspect)
      updateNode(ctx.doc, s.id, size, 'user')
    },
  }
}
