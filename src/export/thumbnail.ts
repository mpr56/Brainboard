import type { Node, Rect } from '../types'
import { drawScene, type Scene } from './draw'
import { loadImages, toBlob } from './exportBoard'
import { exportFrame } from './layout'

/** Output size: a 2:1 card picture at twice its on-screen size. */
export const THUMB_W = 560
export const THUMB_H = 280
/** Never drawn larger than the board itself shows at 100%. */
const MAX_SCALE = 1

/**
 * The world rect a thumbnail shows, and at what scale. The content is fitted
 * whole and centred, and the frame widened to the thumbnail's own shape so the
 * margins are board, not letterbox.
 */
export function thumbnailView(nodes: Node[]): { frame: Rect; scale: number } | null {
  const content = exportFrame(nodes)
  if (!content) return null
  const scale = Math.min(THUMB_W / content.w, THUMB_H / content.h, MAX_SCALE)
  const w = THUMB_W / scale
  const h = THUMB_H / scale
  const cx = content.x + content.w / 2
  const cy = content.y + content.h / 2
  return { frame: { x: cx - w / 2, y: cy - h / 2, w, h }, scale }
}

export function previewCounts(nodes: Node[]): { nodes: number; media: number } {
  const text = nodes.filter((n) => n.type === 'text').length
  return { nodes: text, media: nodes.length - text }
}

/** A small picture of the board, painted from the document like an export. Null when it is empty. */
export async function renderThumbnail(base: Omit<Scene, 'images'>): Promise<Blob | null> {
  const view = thumbnailView(base.nodes)
  if (!view) return null
  const canvas = document.createElement('canvas')
  canvas.width = THUMB_W
  canvas.height = THUMB_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  drawScene(ctx, { ...base, images: await loadImages(base) }, view.frame, view.scale, 'board', 'dots')
  return toBlob(canvas, 'image/webp', 0.85)
}
