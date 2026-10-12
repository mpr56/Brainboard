import { routeFor } from '../geometry/edgeRoute'
import { connectorPath } from '../geometry/ribbon'
import { tint } from '../document/palette'
import { MEDIA_BAR_H, PDF_HEADER_H } from '../media/ingest'
import { TEXT_LAYOUT } from '../render/nodes/TextNode'
import { readTextStyle } from '../render/nodes/textStyle'
import type { AssetId, Edge, EdgeId, EdgeStyleKind, Node, NodeId, Rect } from '../types'
import { wrapText, type ExportBackground, type ExportPattern } from './layout'

/** Board colours, matching World.tsx and NodeLayer.tsx. */
const BOARD = '#eae7df'
const DOT = '#d8d4ca'
const CARD = '#fdfcf9'
const INK = '#1a1a1a'
const SHADOW = 'rgba(26,26,26,.13)'
const DOT_SPACING = 22
const GRID_SPACING = 22
const LINE_SPACING = 30
const CARD_TINT = 0.09

export type Scene = {
  nodes: Node[]
  edges: Edge[]
  edgeColors: Map<EdgeId, string>
  nodeColors: Map<NodeId, string>
  kind: EdgeStyleKind
  /** Decoded pictures for image nodes, by asset id. Missing ones are drawn as placeholders. */
  images: Map<AssetId, CanvasImageSource & { width: number; height: number }>
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function paintBackground(ctx: CanvasRenderingContext2D, frame: Rect, bg: ExportBackground, pattern: ExportPattern) {
  if (bg !== 'transparent') {
    ctx.fillStyle = bg === 'board' ? BOARD : '#ffffff'
    ctx.fillRect(frame.x, frame.y, frame.w, frame.h)
  }
  const x1 = frame.x + frame.w
  const y1 = frame.y + frame.h
  // Patterns are aligned to the world origin, as on the board, so an export of
  // part of the board lines up with an export of the rest.
  const first = (v: number, step: number) => Math.floor(v / step) * step

  if (pattern === 'dots') {
    ctx.fillStyle = DOT
    for (let y = first(frame.y, DOT_SPACING); y <= y1; y += DOT_SPACING) {
      for (let x = first(frame.x, DOT_SPACING); x <= x1; x += DOT_SPACING) {
        ctx.beginPath()
        ctx.arc(x, y, 1.3, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  } else if (pattern === 'grid') {
    ctx.strokeStyle = bg === 'board' ? '#d6d2c7' : '#e3e1db'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = first(frame.x, GRID_SPACING); x <= x1; x += GRID_SPACING) {
      ctx.moveTo(x, frame.y)
      ctx.lineTo(x, y1)
    }
    for (let y = first(frame.y, GRID_SPACING); y <= y1; y += GRID_SPACING) {
      ctx.moveTo(frame.x, y)
      ctx.lineTo(x1, y)
    }
    ctx.stroke()
  } else if (pattern === 'lined') {
    // Ruled paper: pale blue rules and a red margin.
    ctx.strokeStyle = '#c5d3e6'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let y = first(frame.y, LINE_SPACING) + LINE_SPACING; y <= y1; y += LINE_SPACING) {
      ctx.moveTo(frame.x, y)
      ctx.lineTo(x1, y)
    }
    ctx.stroke()
    ctx.strokeStyle = '#e2a3a3'
    ctx.beginPath()
    ctx.moveTo(frame.x + 36, frame.y)
    ctx.lineTo(frame.x + 36, y1)
    ctx.stroke()
  }
}

/** The card every boxed node sits on: hard offset shadow, card, branch-coloured border. */
function paintCard(ctx: CanvasRenderingContext2D, n: Node, color: string | undefined) {
  ctx.fillStyle = SHADOW
  roundRect(ctx, n.x + 4, n.y + 5, n.w, n.h, 10)
  ctx.fill()
  ctx.fillStyle = color ? tint(color, CARD_TINT) : CARD
  roundRect(ctx, n.x, n.y, n.w, n.h, 10)
  ctx.fill()
}

function paintBorder(ctx: CanvasRenderingContext2D, n: Node, color: string | undefined) {
  ctx.strokeStyle = color ?? INK
  ctx.lineWidth = 2
  // The border is inside the box (border-box), so the stroke is inset by half its width.
  roundRect(ctx, n.x + 1, n.y + 1, n.w - 2, n.h - 2, 9)
  ctx.stroke()
}

function paintText(ctx: CanvasRenderingContext2D, n: Node, color: string | undefined) {
  const style = readTextStyle(n.props)
  const text = typeof n.props.text === 'string' ? n.props.text : ''
  if (!style.boxless) paintCard(ctx, n, color)

  const { padX, padY, lineRatio } = TEXT_LAYOUT
  ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 700 : 400} ${style.fontSize}px system-ui, sans-serif`
  ctx.fillStyle = INK
  ctx.textBaseline = 'middle'
  const lineH = style.fontSize * lineRatio
  const innerW = n.w - padX * 2 - (style.boxless ? 0 : 4)
  const lines = wrapText(text, Math.max(1, innerW), (s) => ctx.measureText(s).width)
  const top = n.y + (style.boxless ? 0 : 2) + padY

  lines.forEach((line, i) => {
    const y = top + lineH * i + lineH / 2
    const w = ctx.measureText(line).width
    const x = style.boxless ? n.x + n.w / 2 - w / 2 : n.x + 2 + padX
    ctx.fillText(line, x, y)
    if (style.underline && line) {
      ctx.fillRect(x, y + style.fontSize * 0.45, w, Math.max(1, style.fontSize / 15))
    }
  })

  if (!style.boxless) paintBorder(ctx, n, color)
}

function label(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number) {
  let t = s
  while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -2) + '…'
  ctx.fillText(t, x, y)
}

/** Media is frameless on the board (no card or border), so it is here too. */
function paintMedia(ctx: CanvasRenderingContext2D, n: Node, scene: Scene) {
  const name = typeof n.props.name === 'string' ? n.props.name : ''
  const box = { x: n.x, y: n.y, w: n.w, h: n.h }

  ctx.save()
  roundRect(ctx, box.x, box.y, box.w, box.h, 6)
  ctx.clip()
  ctx.textBaseline = 'middle'

  if (n.type === 'image') {
    const img = n.assetId ? scene.images.get(n.assetId) : undefined
    if (img && img.width > 0 && img.height > 0) {
      // object-fit: cover
      const s = Math.max(box.w / img.width, box.h / img.height)
      const w = img.width * s
      const h = img.height * s
      ctx.drawImage(img, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h)
    } else {
      ctx.fillStyle = '#ece9e0'
      ctx.fillRect(box.x, box.y, box.w, box.h)
    }
  } else if (n.type === 'video') {
    // No frame is decoded for export; a still with a play button stands in.
    ctx.fillStyle = '#111'
    ctx.fillRect(box.x, box.y, box.w, box.h)
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2
    ctx.fillStyle = 'rgba(253,252,249,.9)'
    ctx.beginPath()
    ctx.arc(cx, cy, 20, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#111'
    ctx.beginPath()
    ctx.moveTo(cx - 6, cy - 10)
    ctx.lineTo(cx + 11, cy)
    ctx.lineTo(cx - 6, cy + 10)
    ctx.closePath()
    ctx.fill()
  } else if (n.type === 'audio') {
    ctx.fillStyle = INK
    ctx.fillRect(box.x, box.y, box.w, box.h)
    const barY = box.y + box.h - MEDIA_BAR_H
    ctx.fillStyle = CARD
    ctx.font = '500 12px system-ui, sans-serif'
    label(ctx, `♪  ${name}`, box.x + 12, box.y + (box.h - MEDIA_BAR_H) / 2, box.w - 24)
    ctx.beginPath()
    ctx.arc(box.x + 21, barY + MEDIA_BAR_H / 2, 11, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#4a4a4a'
    ctx.fillRect(box.x + 40, barY + MEDIA_BAR_H / 2 - 2, box.w - 56, 4)
  } else if (n.type === 'pdf') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(box.x, box.y, box.w, box.h)
    ctx.fillStyle = CARD
    ctx.fillRect(box.x, box.y, box.w, PDF_HEADER_H)
    ctx.fillStyle = '#e3e0d7'
    ctx.fillRect(box.x, box.y + PDF_HEADER_H - 1, box.w, 1)
    ctx.fillStyle = '#c0392b'
    roundRect(ctx, box.x + 10, box.y + PDF_HEADER_H / 2 - 7, 26, 14, 3)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = '700 9px system-ui, sans-serif'
    ctx.fillText('PDF', box.x + 14, box.y + PDF_HEADER_H / 2)
    ctx.fillStyle = INK
    ctx.font = '500 12px system-ui, sans-serif'
    label(ctx, name, box.x + 44, box.y + PDF_HEADER_H / 2, box.w - 54)
  }
  ctx.restore()
}

/**
 * Paints `scene` onto `ctx`, framing `frame` (world units) at `scale` output
 * pixels per world unit. Same order as the board: background, connectors,
 * then nodes by z.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  frame: Rect,
  scale: number,
  background: ExportBackground,
  pattern: ExportPattern,
): void {
  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(-frame.x, -frame.y)

  paintBackground(ctx, frame, background, pattern)

  const byId = new Map(scene.nodes.map((n) => [n.id, n] as const))
  for (const e of scene.edges) {
    const route = routeFor(e, byId, scene.kind)
    if (!route) continue
    const d = connectorPath(route.points, route.kind)
    if (!d) continue
    ctx.fillStyle = scene.edgeColors.get(e.id) ?? e.style.color
    ctx.fill(new Path2D(d))
  }

  for (const n of [...scene.nodes].sort((a, b) => a.z - b.z)) {
    const color = scene.nodeColors.get(n.id)
    if (n.type === 'text') paintText(ctx, n, color)
    else paintMedia(ctx, n, scene)
  }
  ctx.restore()
}
