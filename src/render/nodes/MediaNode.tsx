import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { assetUrl } from '../../document/assets'
import { MEDIA_BAR_H, PDF_HEADER_H, mediaSize, type MediaKind } from '../../media/ingest'
import type { AssetId } from '../../types'
import type { NodeTypeDef, NodeViewProps } from '../registry'


/** The object URL for an asset, or null while it loads (and if it is missing). */
export function useAssetUrl(id: AssetId | undefined): { url: string | null; missing: boolean } {
  const [state, setState] = useState<{ id?: AssetId; url: string | null; missing: boolean }>({
    url: null,
    missing: false,
  })
  useEffect(() => {
    if (!id) return
    let alive = true
    void assetUrl(id).then((url) => {
      if (alive) setState({ id, url, missing: url === null })
    })
    return () => {
      alive = false
    }
  }, [id])
  return state.id === id ? state : { url: null, missing: !id }
}

/**
 * Media is frameless (see NodeTypeDef.frameless): the view is the whole node
 * box, and clips to its rounded corners. Clipping happens here, not on the
 * node: the node's handles and delete button sit outside its box and would be
 * clipped away with it.
 */
const frame = (node: NodeViewProps['node']): CSSProperties => ({
  position: 'relative',
  width: '100%',
  height: node.h,
  borderRadius: 6,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
})

/**
 * A video's controls float over its bottom edge and stay out of the way of the
 * picture: shown while paused, or while the pointer is over the video.
 */
const VIDEO_CSS = `
[data-media-video] [data-part="media-controls"] { opacity: 1; transition: opacity .15s ease; }
[data-media-video] [data-part="media-controls"][data-playing="true"] { opacity: 0; }
[data-media-video]:hover [data-part="media-controls"][data-playing="true"] { opacity: 1; }
`

const nameOf = (node: NodeViewProps['node']) => (typeof node.props.name === 'string' ? node.props.name : '')

function Missing({ node, label }: { node: NodeViewProps['node']; label: string }) {
  return (
    <div
      data-testid="media-missing"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: 10,
        color: '#6b675e',
        font: '500 12px system-ui, sans-serif',
        textAlign: 'center',
        background: 'repeating-linear-gradient(45deg, #f3f1ea 0 8px, #ece9e0 8px 16px)',
      }}
    >
      <span>{label}</span>
      <span style={{ fontWeight: 400, wordBreak: 'break-all' }}>{nameOf(node)}</span>
    </div>
  )
}

function ImageView({ node }: NodeViewProps) {
  const { url, missing } = useAssetUrl(node.assetId)
  return (
    <div data-testid="image-node" style={frame(node)}>
      {url ? (
        <img
          src={url}
          alt={nameOf(node)}
          // A native image drag would fight the board's own drag of the node.
          draggable={false}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
        />
      ) : (
        missing && <Missing node={node} label="Image not found" />
      )}
    </div>
  )
}

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

/**
 * Play / pause and a seek track.
 *
 * Every press here stops propagation, the way the node's delete button does:
 * the viewport would otherwise capture the pointer and start dragging the
 * node. The rest of the node is still a drag surface, so a playing video can
 * be moved like anything else.
 */
function Controls({
  media,
  kind,
  overlay = false,
}: {
  media: HTMLMediaElement | null
  kind: 'video' | 'audio'
  /** Float over the bottom of the picture instead of taking a strip of its own. */
  overlay?: boolean
}) {
  const [, tick] = useState(0)
  const track = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!media) return
    const rerender = () => tick((n) => n + 1)
    const events = ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata']
    for (const ev of events) media.addEventListener(ev, rerender)
    return () => {
      for (const ev of events) media.removeEventListener(ev, rerender)
    }
  }, [media])

  const playing = media ? !media.paused && !media.ended : false
  const duration = media && Number.isFinite(media.duration) ? media.duration : 0
  const t = media?.currentTime ?? 0

  const seekTo = (e: PointerEvent<HTMLDivElement>) => {
    const el = track.current
    if (!media || !el || duration <= 0) return
    const r = el.getBoundingClientRect()
    media.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration
  }

  return (
    <div
      data-part="media-controls"
      data-testid={`${kind}-controls`}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      data-playing={playing ? 'true' : undefined}
      style={{
        height: MEDIA_BAR_H,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 10px',
        ...(overlay
          ? {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              background: 'linear-gradient(transparent, rgba(0,0,0,.65))',
            }
          : { background: '#1a1a1a' }),
        color: '#fdfcf9',
        font: '500 11px ui-monospace, monospace',
        cursor: 'default',
      }}
    >
      <button
        type="button"
        data-testid="media-play"
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause' : 'Play'}
        onClick={() => {
          if (!media) return
          if (playing) media.pause()
          else void media.play().catch(() => {})
        }}
        style={{
          width: 22,
          height: 22,
          padding: 0,
          border: 'none',
          borderRadius: '50%',
          background: '#fdfcf9',
          color: '#1a1a1a',
          font: '700 10px/1 system-ui, sans-serif',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <div
        ref={track}
        data-testid="media-seek"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          seekTo(e)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) seekTo(e)
        }}
        style={{ flex: 1, height: 14, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
      >
        <div style={{ position: 'relative', width: '100%', height: 4, borderRadius: 2, background: '#4a4a4a' }}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              width: `${duration > 0 ? (t / duration) * 100 : 0}%`,
              borderRadius: 2,
              background: '#fdfcf9',
            }}
          />
        </div>
      </div>
      <span style={{ flex: 'none' }}>
        {fmt(t)} / {fmt(duration)}
      </span>
    </div>
  )
}

function VideoView({ node }: NodeViewProps) {
  const { url, missing } = useAssetUrl(node.assetId)
  const [media, setMedia] = useState<HTMLVideoElement | null>(null)
  return (
    <div data-testid="video-node" data-media-video style={frame(node)}>
      <style>{VIDEO_CSS}</style>
      {url ? (
        <>
          <video
            ref={setMedia}
            src={url}
            playsInline
            preload="metadata"
            // Clicks on the picture belong to the board (select, drag). The
            // control bar over its bottom edge is the only part that drives
            // playback.
            style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#111', pointerEvents: 'none' }}
          />
          <Controls media={media} kind="video" overlay />
        </>
      ) : (
        missing && <Missing node={node} label="Video not found" />
      )}
    </div>
  )
}

function AudioView({ node }: NodeViewProps) {
  const { url, missing } = useAssetUrl(node.assetId)
  const [media, setMedia] = useState<HTMLAudioElement | null>(null)
  return (
    <div data-testid="audio-node" style={{ ...frame(node), background: '#1a1a1a' }}>
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 12px',
          font: '500 12px system-ui, sans-serif',
          color: '#fdfcf9',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
        }}
      >
        <span aria-hidden="true">♪</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf(node)}</span>
      </div>
      {url ? (
        <>
          <audio ref={setMedia} src={url} preload="metadata" />
          <Controls media={media} kind="audio" />
        </>
      ) : (
        missing && <Missing node={node} label="Audio not found" />
      )}
    </div>
  )
}

/**
 * A PDF in the browser's own viewer.
 *
 * The viewer is an iframe, which would swallow every press on the node, so it
 * ignores the pointer until the node is opened with a double-click — the same
 * gesture that opens a text node for typing. Clicking anywhere off the node
 * closes it again and the node goes back to being draggable.
 */
function PdfView({ node, state }: NodeViewProps) {
  const { url, missing } = useAssetUrl(node.assetId)
  return (
    <div data-testid="pdf-node" data-open={state.editing ? 'true' : undefined} style={frame(node)}>
      <div
        style={{
          height: PDF_HEADER_H,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 10px',
          background: '#fdfcf9',
          borderBottom: '1px solid #e3e0d7',
          font: '500 12px system-ui, sans-serif',
          color: '#1a1a1a',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        <span style={{ font: '700 9px system-ui', padding: '2px 4px', borderRadius: 3, background: '#c0392b', color: '#fff' }}>
          PDF
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf(node)}</span>
        <span style={{ color: '#8a867c', fontWeight: 400, fontSize: 11 }}>
          {state.editing ? 'click off to close' : 'double-click to read'}
        </span>
      </div>
      {url ? (
        <iframe
          title={nameOf(node) || 'PDF'}
          src={`${url}#toolbar=0&navpanes=0`}
          style={{ flex: 1, border: 'none', width: '100%', background: '#fff', pointerEvents: state.editing ? 'auto' : 'none' }}
        />
      ) : (
        missing && <Missing node={node} label="PDF not found" />
      )}
    </div>
  )
}

const def = (
  type: MediaKind,
  View: NodeTypeDef['View'],
  extra: Partial<NodeTypeDef> = {},
): NodeTypeDef => ({
  type,
  domOnly: true,
  defaultSize: () => mediaSize(type),
  View,
  resizable: type !== 'audio',
  keepAspect: type === 'image' || type === 'video',
  frameless: true,
  ...extra,
})

export const MEDIA_NODE_TYPES: NodeTypeDef[] = [
  def('image', ImageView),
  def('video', VideoView),
  def('audio', AudioView),
  def('pdf', PdfView, { editable: true }),
]
