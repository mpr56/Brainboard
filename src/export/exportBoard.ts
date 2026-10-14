import { assetUrl } from '../document/assets'
import type { AssetId } from '../types'
import { drawScene, type Scene } from './draw'
import { clampScale, effectiveOptions, exportFrame, exportFileName, type ExportOptions } from './layout'
import { PX_TO_PT, jpegToPdf } from './pdf'

type Picture = CanvasImageSource & { width: number; height: number }

/** Decodes every image node's picture, skipping any whose file is missing. */
export async function loadImages(scene: Omit<Scene, 'images'>): Promise<Map<AssetId, Picture>> {
  const out = new Map<AssetId, Picture>()
  await Promise.all(
    scene.nodes
      .filter((n) => n.type === 'image' && n.assetId)
      .map(async (n) => {
        const url = await assetUrl(n.assetId!)
        if (!url) return
        const img = new Image()
        img.src = url
        try {
          await img.decode()
          out.set(n.assetId!, img)
        } catch {
          // Undecodable: drawn as an empty frame rather than failing the export.
        }
      }),
  )
  return out
}

export const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not encode the image.'))), type, quality),
  )

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoked on the next tick, once the download has taken its own reference.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Renders the scene to an image or a PDF and downloads it.
 *
 * Painted from the document, not screenshotted from the DOM: the export is the
 * whole board (or selection) at the chosen resolution, whatever is currently
 * scrolled into view, and without hover handles, selection rings or menus.
 */
export async function exportBoard(
  base: Omit<Scene, 'images'>,
  options: ExportOptions,
  title: string,
): Promise<void> {
  const opts = effectiveOptions(options)
  const frame = exportFrame(base.nodes)
  if (!frame) throw new Error('There is nothing on the board to export.')
  const scale = clampScale(frame, opts.scale)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(frame.w * scale))
  canvas.height = Math.max(1, Math.round(frame.h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot draw the export.')

  const scene: Scene = { ...base, images: await loadImages(base) }
  drawScene(ctx, scene, frame, scale, opts.background, opts.pattern)

  const name = exportFileName(title, opts.format)
  if (opts.format === 'png') return download(await toBlob(canvas, 'image/png'), name)
  if (opts.format === 'jpeg') return download(await toBlob(canvas, 'image/jpeg', 0.92), name)

  const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer())
  // The page is the board's size in CSS pixels, so it prints at the size it
  // looks on screen at 100%; the extra resolution is there for zooming in.
  const pdf = jpegToPdf(
    jpeg,
    { w: canvas.width, h: canvas.height },
    { w: frame.w * PX_TO_PT, h: frame.h * PX_TO_PT },
  )
  download(new Blob([pdf], { type: 'application/pdf' }), name)
}
