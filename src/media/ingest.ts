import { nanoid } from 'nanoid'
import type * as Y from 'yjs'
import { primeAssetUrl, putAssetBlob } from '../document/assets'
import { addNode } from '../document/nodes'
import { transact } from '../document/schema'
import type { NodeId, Point } from '../types'

export type MediaKind = 'image' | 'video' | 'audio' | 'pdf'

export const MEDIA_KINDS: readonly MediaKind[] = ['image', 'video', 'audio', 'pdf']

/** What the file picker offers. Kept beside `mediaKind` so the two agree. */
export const MEDIA_ACCEPT = 'image/*,video/*,audio/*,application/pdf,.pdf'

/** Longest side a newly added picture or video is given, in world units. */
export const MEDIA_MAX = 360
/** Height of the play / seek bar: floated over a video's bottom edge, and the bottom of an audio node. */
export const MEDIA_BAR_H = 34
/** Height of the title strip above a PDF. */
export const PDF_HEADER_H = 30
const AUDIO_W = 280
const PDF_PAGE = { w: 300, h: 390 }
/** Gap left between files dropped together, which are laid out in a row. */
const ROW_GAP = 40

/** Which kind of media node a file becomes, or null for a file we cannot show. */
export function mediaKind(mime: string, name = ''): MediaKind | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf'
  return null
}

/**
 * The box a media node starts at: the file's own proportions, longest side
 * MEDIA_MAX, never scaled up past its natural size. A video's controls float
 * over the picture, so it is exactly the picture's size.
 */
export function mediaSize(kind: MediaKind, natural?: { w: number; h: number }): { w: number; h: number } {
  if (kind === 'audio') return { w: AUDIO_W, h: MEDIA_BAR_H + 22 }
  if (kind === 'pdf') return { w: PDF_PAGE.w, h: PDF_PAGE.h + PDF_HEADER_H }
  const w0 = natural && natural.w > 0 ? natural.w : 16
  const h0 = natural && natural.h > 0 ? natural.h : 9
  const s = Math.min(1, MEDIA_MAX / Math.max(w0, h0))
  const w = Math.max(80, Math.round(w0 * s))
  const h = Math.round(w * (h0 / w0))
  return { w, h }
}

type Probe = { w?: number; h?: number; duration?: number }

/** Reads a file's pixel size and running time by letting the browser decode it. */
function probe(kind: MediaKind, url: string): Promise<Probe> {
  return new Promise((resolve) => {
    // A file the browser cannot decode still becomes a node, at a default
    // size, rather than failing the whole drop.
    const done = (p: Probe) => resolve(p)
    if (kind === 'image') {
      const img = new Image()
      img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => done({})
      img.src = url
    } else if (kind === 'video' || kind === 'audio') {
      const el = document.createElement(kind)
      el.preload = 'metadata'
      el.onloadedmetadata = () =>
        done({
          w: el instanceof HTMLVideoElement ? el.videoWidth : undefined,
          h: el instanceof HTMLVideoElement ? el.videoHeight : undefined,
          duration: Number.isFinite(el.duration) ? el.duration : undefined,
        })
      el.onerror = () => done({})
      el.src = url
    } else {
      done({})
    }
  })
}

/**
 * Adds files to the board as media nodes, in a row centred on `at`. All of
 * them land as ONE undo step.
 *
 * The bytes are written to the media store before the nodes exist, so no view
 * can ever look for a file that is not there yet. Files we cannot show are
 * skipped; the ids of the nodes made are returned.
 */
export async function ingestFiles(doc: Y.Doc, files: File[], at: Point): Promise<NodeId[]> {
  const prepared: { kind: MediaKind; file: File; assetId: string; size: { w: number; h: number }; p: Probe }[] = []
  for (const file of files) {
    const kind = mediaKind(file.type, file.name)
    if (!kind) continue
    const assetId = nanoid()
    await putAssetBlob(assetId, file)
    primeAssetUrl(assetId, file)
    const url = URL.createObjectURL(file)
    const p = await probe(kind, url)
    URL.revokeObjectURL(url)
    prepared.push({ kind, file, assetId, size: mediaSize(kind, p.w && p.h ? { w: p.w, h: p.h } : undefined), p })
  }
  if (prepared.length === 0) return []

  // The row as a whole is centred on the point, so a single file is too.
  const totalW = prepared.reduce((sum, m) => sum + m.size.w, 0) + ROW_GAP * (prepared.length - 1)
  let x = at.x - totalW / 2

  const ids: NodeId[] = []
  transact(doc, 'user', () => {
    for (const m of prepared) {
      const props: Record<string, unknown> = { name: m.file.name, mime: m.file.type }
      if (m.p.w && m.p.h) {
        props.naturalW = m.p.w
        props.naturalH = m.p.h
      }
      if (m.p.duration !== undefined) props.duration = m.p.duration
      ids.push(
        addNode(
          doc,
          {
            type: m.kind,
            x,
            y: at.y - m.size.h / 2,
            w: m.size.w,
            h: m.size.h,
            assetId: m.assetId,
            props,
          },
          'user',
        ),
      )
      x += m.size.w + ROW_GAP
    }
  })
  return ids
}
