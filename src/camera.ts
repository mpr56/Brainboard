import type { Point, Rect } from './types'

export type Camera = { x: number; y: number; zoom: number }

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 4

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function worldToScreen(p: Point, cam: Camera): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom }
}

export function screenToWorld(p: Point, cam: Camera): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y }
}

/** A world-space rect as it appears on screen — what a screen-space popover anchors to. */
export function worldRectToScreen(r: Rect, cam: Camera): Rect {
  const tl = worldToScreen({ x: r.x, y: r.y }, cam)
  return { x: tl.x, y: tl.y, w: r.w * cam.zoom, h: r.h * cam.zoom }
}

export function visibleWorldRect(
  cam: Camera,
  viewport: { w: number; h: number },
  marginPx = 0,
): Rect {
  const tl = screenToWorld({ x: -marginPx, y: -marginPx }, cam)
  const br = screenToWorld({ x: viewport.w + marginPx, y: viewport.h + marginPx }, cam)
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }
}

/** Zooms about a screen point, keeping the world point under it fixed. */
export function zoomAt(cam: Camera, screenPoint: Point, factor: number): Camera {
  const zoom = clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM)
  const anchored = screenToWorld(screenPoint, cam)
  return {
    zoom,
    x: anchored.x - screenPoint.x / zoom,
    y: anchored.y - screenPoint.y / zoom,
  }
}

/** Moves the camera so content follows a screen-space drag delta. */
export function panBy(cam: Camera, screenDelta: Point): Camera {
  return { ...cam, x: cam.x - screenDelta.x / cam.zoom, y: cam.y - screenDelta.y / cam.zoom }
}

/**
 * CSS transform for the world element. `transform-origin: 0 0` is required.
 * Right-to-left application gives screen = (world - cam) * zoom.
 */
export function worldTransform(cam: Camera): string {
  return `scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

/** Never zoom in past this when fitting, so one small node does not fill the screen. */
export const FIT_MAX_ZOOM = 1.5

/** The smallest rect containing every rect given, or null for none. */
export function boundsOf(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * The camera that shows all of `bounds` as large as it will go, centred
 * exactly in the viewport, with `paddingPx` of screen space kept clear round
 * it. Zoom is capped at FIT_MAX_ZOOM (and the usual limits); a board with
 * nothing on it centres the world origin at 100%.
 */
export function fitCamera(
  bounds: Rect | null,
  viewport: { w: number; h: number },
  paddingPx = 64,
): Camera {
  if (!bounds || viewport.w <= 0 || viewport.h <= 0) {
    return { x: -viewport.w / 2, y: -viewport.h / 2, zoom: 1 }
  }
  const availW = Math.max(1, viewport.w - paddingPx * 2)
  const availH = Math.max(1, viewport.h - paddingPx * 2)
  const zoom = clamp(
    Math.min(availW / Math.max(bounds.w, 1), availH / Math.max(bounds.h, 1), FIT_MAX_ZOOM),
    MIN_ZOOM,
    MAX_ZOOM,
  )
  const cx = bounds.x + bounds.w / 2
  const cy = bounds.y + bounds.h / 2
  return { zoom, x: cx - viewport.w / 2 / zoom, y: cy - viewport.h / 2 / zoom }
}
