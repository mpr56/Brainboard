import { boundsOf } from '../camera'
import type { Edge, Node, NodeId, Rect } from '../types'
import { BOARD_FILE_EXTENSION } from './boardFile'

export type ExportFormat = 'png' | 'jpeg' | 'pdf'
export type ExportBackground = 'board' | 'white' | 'transparent'
export type ExportPattern = 'none' | 'dots' | 'grid' | 'lined'
export type ExportScope = 'board' | 'selection'

export type ExportOptions = {
  format: ExportFormat
  background: ExportBackground
  pattern: ExportPattern
  /** Output pixels per world unit. */
  scale: number
  scope: ExportScope
}

export const DEFAULT_EXPORT: ExportOptions = {
  format: 'png',
  background: 'board',
  pattern: 'dots',
  scale: 2,
  scope: 'board',
}

/** Space left round the content in an export, world units. */
export const EXPORT_PADDING = 48

/**
 * A browser refuses to make a canvas past a certain size and hands back a
 * blank one instead, with no error. These are inside every current browser's
 * limits.
 */
export const MAX_CANVAS_SIDE = 16000
export const MAX_CANVAS_AREA = 120_000_000

/** Only JPEG and PDF (which embeds a JPEG) cannot be see-through. */
export const supportsTransparency = (f: ExportFormat) => f === 'png'

/**
 * The options as they will actually be honoured: a transparent background is
 * not something a JPEG or a PDF can have, so those fall back to white.
 */
export function effectiveOptions(o: ExportOptions): ExportOptions {
  return o.background === 'transparent' && !supportsTransparency(o.format)
    ? { ...o, background: 'white' }
    : o
}

/** What gets exported: the whole board, or the selected nodes and the links between them. */
export function exportContent(
  nodes: Node[],
  edges: Edge[],
  scope: ExportScope,
  selection: ReadonlySet<NodeId>,
): { nodes: Node[]; edges: Edge[] } {
  if (scope === 'board' || selection.size === 0) return { nodes, edges }
  const kept = nodes.filter((n) => selection.has(n.id))
  return {
    nodes: kept,
    edges: edges.filter((e) => selection.has(e.from.nodeId) && selection.has(e.to.nodeId)),
  }
}

/**
 * The world-space rect an export covers: every node, plus padding. Connectors
 * run between node borders, so the nodes alone bound them — except for the
 * curve's bulge, which the padding absorbs.
 */
export function exportFrame(nodes: Node[], padding = EXPORT_PADDING): Rect | null {
  const b = boundsOf(nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })))
  if (!b) return null
  return { x: b.x - padding, y: b.y - padding, w: b.w + padding * 2, h: b.h + padding * 2 }
}

/** The largest scale at or below `wanted` that the browser will make a canvas for. */
export function clampScale(frame: Pick<Rect, 'w' | 'h'>, wanted: number): number {
  const bySide = MAX_CANVAS_SIDE / Math.max(frame.w, frame.h, 1)
  const byArea = Math.sqrt(MAX_CANVAS_AREA / Math.max(frame.w * frame.h, 1))
  return Math.max(0.05, Math.min(wanted, bySide, byArea))
}

/**
 * Breaks text into the lines a `pre-wrap; break-word` box `maxW` wide would
 * show: hard line breaks kept, words wrapped greedily, a word too long for a
 * line broken between characters. `measure` is the width of a string in the
 * font being used — injected so this stays pure and testable.
 */
export function wrapText(text: string, maxW: number, measure: (s: string) => number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    // Words with the spaces after them, so a line keeps its own spacing.
    const words = para.match(/\S+\s*|\s+/g) ?? ['']
    let line = ''
    for (const word of words) {
      if (measure(line + word.trimEnd()) <= maxW) {
        line += word
        continue
      }
      if (line) out.push(line.trimEnd())
      // A word wider than the whole line is split wherever it has to be.
      let rest = word
      while (measure(rest.trimEnd()) > maxW && rest.length > 1) {
        let cut = 1
        while (cut < rest.length && measure(rest.slice(0, cut + 1)) <= maxW) cut++
        out.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      line = rest
    }
    out.push(line.trimEnd())
  }
  return out
}

/** A file name for the export, from the board's title and today's date. */
export function exportFileName(title: string, format: ExportFormat | 'board', now = new Date()): string {
  const safe = title.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-') || 'board'
  const day = now.toISOString().slice(0, 10)
  if (format === 'board') return `${safe}-${day}${BOARD_FILE_EXTENSION}`
  return `${safe}-${day}.${format === 'jpeg' ? 'jpg' : format}`
}
