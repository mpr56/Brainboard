import type { Dir, Point, Rect } from '../types'

/** World-space gap left between a node and the child spawned off its handle. */
export const SPAWN_GAP = 90

/**
 * Where the centre of a new node goes when it is spawned off `rect`'s handle
 * on side `dir`.
 *
 * The child is centred on the parent's axis and the gap is measured between
 * the two *boxes*, not between their centres — so the spacing reads the same
 * whatever size the child turns out to be, and a child can never overlap the
 * parent it came from.
 */
export function spawnCentre(
  rect: Rect,
  dir: Dir,
  size: { w: number; h: number },
  gap: number = SPAWN_GAP,
): Point {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2

  switch (dir) {
    case 'n':
      return { x: cx, y: rect.y - gap - size.h / 2 }
    case 's':
      return { x: cx, y: rect.y + rect.h + gap + size.h / 2 }
    case 'w':
      return { x: rect.x - gap - size.w / 2, y: cy }
    case 'e':
      return { x: rect.x + rect.w + gap + size.w / 2, y: cy }
  }
}
