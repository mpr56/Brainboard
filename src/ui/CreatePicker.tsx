import { useEffect, useRef, useState } from 'react'
import type { Point } from '../types'

export type CreateKind = 'text' | 'media'

/** Sideways travel, in screen pixels, that counts as a swipe to one side. */
export const SWIPE_PX = 36
/** Leaning this far towards a side lights it up before it is picked. */
const LEAN_PX = 8
/** Wandering this far off without swiping sideways closes the picker. */
const CANCEL_PX = 140
export const PICKER_SIZE = 128
const R = PICKER_SIZE / 2
const EDGE_PX = 8

type Props = {
  /** Where the double-click landed, in client (window) coordinates. */
  at: Point
  onPick: (kind: CreateKind) => void
  onCancel: () => void
}

/**
 * Whether the page may still open a file chooser. Browsers only allow it
 * shortly after a real press; a swipe is pointer movement, which does not
 * count, so it rides on the double-click that opened the picker. Browsers that
 * do not report this are assumed to allow it.
 */
const mayOpenChooser = () =>
  (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? true

const CSS = `
@keyframes create-picker-in {
  from { opacity: 0; transform: scale(.6); }
  to   { opacity: 1; transform: none; }
}
[data-testid="create-picker"] { animation: create-picker-in .14s cubic-bezier(.2,.9,.3,1.25); }
[data-testid="create-picker"] [data-side] { transition: fill .08s ease; }
`

/**
 * What a double-click on empty canvas opens: a small wheel split in two, Text
 * on the left and Media on the right. Swipe towards a side to pick it, or
 * click it; the arrow keys work too. Esc, or a press anywhere else, closes it.
 *
 * It listens on the window rather than on itself so a swipe works with no
 * button held — with a mouse, the double-click is over before the swipe
 * starts.
 */
export function CreatePicker({ at, onPick, onCancel }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const [lean, setLean] = useState<CreateKind | null>(null)
  // Latest callbacks, so the window listeners are attached once.
  const cb = useRef({ onPick, onCancel })
  cb.current = { onPick, onCancel }

  useEffect(() => {
    let done = false
    const finish = (kind: CreateKind | null) => {
      if (done) return
      done = true
      if (kind) cb.current.onPick(kind)
      else cb.current.onCancel()
    }

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - at.x
      const dy = e.clientY - at.y
      const side: CreateKind | null =
        Math.abs(dx) >= LEAN_PX && Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'text' : 'media') : null
      setLean(side)
      if (side && Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.2) {
        // Too late to open a file chooser: light Media up and wait for a click.
        if (side === 'media' && !mayOpenChooser()) return
        finish(side)
      } else if (Math.hypot(dx, dy) > CANCEL_PX) {
        finish(null)
      }
    }

    const onDown = (e: PointerEvent) => {
      // Presses on the wheel itself are its own (see the sides below).
      if (root.current?.contains(e.target as Node)) return
      finish(null)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 't') finish('text')
      else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'm') finish('media')
      else if (e.key === 'Escape') finish(null)
      else return
      e.preventDefault()
      e.stopPropagation()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      done = true
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [at.x, at.y])

  const left = Math.min(Math.max(EDGE_PX, at.x - R), window.innerWidth - PICKER_SIZE - EDGE_PX)
  const top = Math.min(Math.max(EDGE_PX, at.y - R), window.innerHeight - PICKER_SIZE - EDGE_PX)

  const half = (kind: CreateKind) => {
    const on = lean === kind
    // A half-disc with a gap down the middle.
    const x = kind === 'text' ? R - 3 : R + 3
    const sweep = kind === 'text' ? 0 : 1
    const d = `M ${x} ${R - (R - 2)} A ${R - 2} ${R - 2} 0 0 ${sweep} ${x} ${R + (R - 2)} Z`
    return (
      <g
        key={kind}
        role="button"
        aria-label={kind === 'text' ? 'New text' : 'Add media'}
        data-testid={`create-${kind}`}
        data-lean={on ? 'true' : undefined}
        style={{ cursor: 'pointer' }}
        onPointerDown={(e) => {
          e.stopPropagation()
          cb.current.onPick(kind)
        }}
      >
        <path data-side d={d} fill={on ? '#1a1a1a' : '#fdfcf9'} stroke="#1a1a1a" strokeWidth={2} />
        <text
          x={kind === 'text' ? R - 30 : R + 30}
          y={R - 6}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ font: kind === 'text' ? '700 17px Georgia, serif' : '600 16px system-ui', fill: on ? '#fdfcf9' : '#1a1a1a' }}
        >
          {kind === 'text' ? 'Aa' : '▣'}
        </text>
        <text
          x={kind === 'text' ? R - 30 : R + 30}
          y={R + 16}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ font: '600 11px system-ui, sans-serif', fill: on ? '#fdfcf9' : '#1a1a1a' }}
        >
          {kind === 'text' ? '‹ Text' : 'Media ›'}
        </text>
      </g>
    )
  }

  return (
    <div
      ref={root}
      data-testid="create-picker-anchor"
      role="menu"
      aria-label="Add to the board"
      style={{ position: 'fixed', left, top, width: PICKER_SIZE, height: PICKER_SIZE, zIndex: 25, userSelect: 'none' }}
    >
      <style>{CSS}</style>
      <svg
        data-testid="create-picker"
        width={PICKER_SIZE}
        height={PICKER_SIZE}
        viewBox={`0 0 ${PICKER_SIZE} ${PICKER_SIZE}`}
        style={{ display: 'block', overflow: 'visible', filter: 'drop-shadow(4px 5px 0 rgba(26,26,26,.13))' }}
      >
        {half('text')}
        {half('media')}
      </svg>
    </div>
  )
}
