import type { Dir, EdgeStyleKind, Point } from '../types'

export type Path = { d: string; points: Point[] }

const MIN_CONTROL = 40
const CONTROL_RATIO = 0.5

const OUTWARD: Record<Dir, Point> = {
  n: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  e: { x: 1, y: 0 },
  w: { x: -1, y: 0 },
}

const OPPOSITE: Record<Dir, Dir> = { n: 's', s: 'n', e: 'w', w: 'e' }

/**
 * Whether a style's centreline is a single cubic. `arrow` differs from `curve`
 * only in how it is painted, so everything that routes or samples a connector
 * asks this rather than comparing against `'curve'`.
 */
export const isCurved = (kind: EdgeStyleKind): boolean => kind === 'curve' || kind === 'arrow'

/**
 * The sides each end leaves and arrives through. An end with no side of its
 * own (a locator, or the cursor during a preview) mirrors the other end, so
 * the connector still runs along one axis; with neither known it is the
 * horizontal default every connector used to have.
 */
function resolveSides(from: Point, to: Point, a?: Dir, b?: Dir): [Dir, Dir] {
  if (a && b) return [a, b]
  if (a) return [a, OPPOSITE[a]]
  if (b) return [OPPOSITE[b], b]
  const out: Dir = to.x >= from.x ? 'e' : 'w'
  return [out, OPPOSITE[out]]
}

/**
 * Pure geometry (rule 4): returns data that SVG paints. No DOM, no camera —
 * paths are computed in world units and transformed by the world layer.
 *
 * `fromSide`/`toSide` name the node side each end sits on. A curve's handles
 * and an elbow's first and last legs run outward along them, so a connector
 * always meets its node square-on instead of skimming along the border.
 */
export function routeEdge(
  from: Point,
  to: Point,
  kind: EdgeStyleKind,
  fromSide?: Dir,
  toSide?: Dir,
): Path {
  const [s1, s2] = resolveSides(from, to, fromSide, toSide)
  const vertical = s1 === 'n' || s1 === 's'

  const route: Exclude<EdgeStyleKind, 'arrow'> = kind === 'arrow' ? 'curve' : kind
  switch (route) {
    case 'straight': {
      const points = [from, to]
      return { points, d: pathD(points, kind) }
    }

    case 'elbow': {
      const points = vertical
        ? [from, { x: from.x, y: (from.y + to.y) / 2 }, { x: to.x, y: (from.y + to.y) / 2 }, to]
        : [from, { x: (from.x + to.x) / 2, y: from.y }, { x: (from.x + to.x) / 2, y: to.y }, to]
      return { points, d: pathD(points, kind) }
    }

    case 'curve': {
      const span = vertical ? Math.abs(to.y - from.y) : Math.abs(to.x - from.x)
      const offset = Math.max(MIN_CONTROL, span * CONTROL_RATIO)
      const c1 = { x: from.x + OUTWARD[s1].x * offset, y: from.y + OUTWARD[s1].y * offset }
      const c2 = { x: to.x + OUTWARD[s2].x * offset, y: to.y + OUTWARD[s2].y * offset }
      const points = [from, c1, c2, to]
      return { points, d: pathD(points, kind) }
    }
  }
}

/**
 * Re-emits a routed path's points as SVG path data.
 *
 * Separate from `routeEdge` so a painter that works in a different coordinate
 * space can map the points and re-emit without re-routing. Applying an affine
 * map (which world→screen is) to a cubic's control points yields exactly the
 * mapped curve, so the screen-space preview and the world-space committed edge
 * are the same shape rather than two approximations of it.
 */
export function pathD(points: Point[], kind: EdgeStyleKind): string {
  if (points.length === 0) return ''
  const [from, c1, c2, to] = points
  if (isCurved(kind) && from && c1 && c2 && to) {
    return `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`
  }
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}
