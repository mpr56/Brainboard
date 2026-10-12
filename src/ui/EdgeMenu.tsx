import type { Point } from '../types'
import { ColorWheel } from './ColorWheel'

const DELETE_SIZE = 26
/** The wheel anchors to a box; a link's box is a small square round its midpoint. */
const ANCHOR = 14

type Props = {
  /** The link's midpoint on screen. */
  at: Point
  viewport: { w: number; h: number }
  /** The colour picked for this link, if any. Highlighted, and what Auto clears. */
  current: string | null
  /** The colour the link is painted right now, picked or inherited. */
  effective: string | null
  onPick: (color: string | null) => void
  onDelete: () => void
}

/**
 * What opens when a link is clicked: the same colour wheel a node gets, and a
 * delete button sitting on the link itself.
 *
 * Like the wheel, it lives in screen space outside the viewport, so pressing
 * it never starts a gesture on the board underneath.
 */
export function EdgeMenu({ at, viewport, current, effective, onPick, onDelete }: Props) {
  return (
    <>
      <ColorWheel
        anchor={{ x: at.x - ANCHOR, y: at.y - ANCHOR, w: ANCHOR * 2, h: ANCHOR * 2 }}
        viewport={viewport}
        current={current}
        effective={effective}
        onPick={onPick}
      />
      <button
        type="button"
        data-testid="edge-delete"
        title="Delete this link (Delete)"
        aria-label="Delete this link"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onDelete}
        style={{
          position: 'absolute',
          left: at.x - DELETE_SIZE / 2,
          top: at.y - DELETE_SIZE / 2,
          width: DELETE_SIZE,
          height: DELETE_SIZE,
          zIndex: 21,
          borderRadius: '50%',
          border: '2px solid #1a1a1a',
          background: '#fdfcf9',
          color: '#1a1a1a',
          font: '600 14px/1 system-ui, sans-serif',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          cursor: 'pointer',
          boxShadow: '3px 4px 0 rgba(26,26,26,.13)',
        }}
      >
        ×
      </button>
    </>
  )
}
