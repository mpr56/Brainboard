import { describe, expect, it } from 'vitest'
import type { Point } from '../types'
import {
  ARROW_HEAD_W,
  ARROW_LINE_W,
  RIBBON_END_W,
  RIBBON_START_W,
  arrowPath,
  connectorPath,
  ribbonPath,
  sampleCenterline,
} from './ribbon'

/** "M 1 2 L 3 4 Z" -> [[1,2],[3,4]] */
const points = (d: string): Point[] =>
  d
    .replace(/Z$/, '')
    .split(/(?=[ML])/)
    .map((s) => s.trim().replace(/^[ML]\s*/, ''))
    .filter(Boolean)
    .map((s) => {
      const [x, y] = s.split(/\s+/).map(Number)
      return { x: x!, y: y! }
    })

const horizontal: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
]

describe('sampleCenterline', () => {
  it('walks a straight line evenly', () => {
    const pts = sampleCenterline(horizontal, 'straight', 4)
    expect(pts.map((p) => p.x)).toEqual([0, 25, 50, 75, 100])
    expect(pts.every((p) => p.y === 0)).toBe(true)
  })

  it('returns n+1 samples, so both endpoints are included', () => {
    expect(sampleCenterline(horizontal, 'straight', 10)).toHaveLength(11)
  })

  it('evaluates a curve as a cubic rather than a polyline through its controls', () => {
    const cubic: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ]
    const mid = sampleCenterline(cubic, 'curve', 2)[1]!
    // A cubic's midpoint is the average of its control points weighted
    // 1/8, 3/8, 3/8, 1/8 — y = 75, not the 100 a polyline would give.
    expect(mid).toEqual({ x: 50, y: 75 })
  })

  // Walking by arc length keeps samples evenly spread across a corner instead
  // of bunching them on the shorter leg.
  it('spaces samples by arc length across an elbow, not per segment', () => {
    const elbow: Point[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 10 },
    ]
    const pts = sampleCenterline(elbow, 'elbow', 4)
    const steps = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y))
    for (const s of steps) expect(s).toBeCloseTo(10, 5)
  })

  it('returns nothing for a degenerate path', () => {
    expect(sampleCenterline([{ x: 5, y: 5 }], 'straight', 8)).toEqual([])
    expect(
      sampleCenterline(
        [
          { x: 5, y: 5 },
          { x: 5, y: 5 },
        ],
        'straight',
        8,
      ),
    ).toEqual([])
  })
})

describe('ribbonPath', () => {
  it('returns a closed shape rather than an open line', () => {
    const d = ribbonPath(horizontal, 'straight')
    expect(d.startsWith('M ')).toBe(true)
    expect(d.endsWith(' Z')).toBe(true)
  })

  // The whole point: direction is legible from the shape, with no arrowhead.
  it('is wider at the source than at the target', () => {
    const d = ribbonPath(horizontal, 'straight', 20, 4, 8)
    const pts = points(d)
    // Forward pass runs left-side start -> end; the reversed return pass puts
    // the right-side end immediately after it and the right-side start last.
    const startPair = [pts[0]!, pts[pts.length - 1]!]
    const endPair = [pts[8]!, pts[9]!]

    expect(Math.abs(startPair[0]!.y - startPair[1]!.y)).toBeCloseTo(20, 5)
    expect(Math.abs(endPair[0]!.y - endPair[1]!.y)).toBeCloseTo(4, 5)
  })

  it('tapers monotonically along its length', () => {
    const n = 12
    const d = ribbonPath(horizontal, 'straight', 20, 4, n)
    const pts = points(d)
    const widths: number[] = []
    for (let i = 0; i <= n; i++) {
      // Sample i on the forward (left) pass pairs with the mirrored sample on
      // the reversed (right) pass.
      widths.push(Math.abs(pts[i]!.y - pts[2 * n + 1 - i]!.y))
    }
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]!).toBeLessThan(widths[i - 1]! + 1e-9)
    }
    expect(widths[0]!).toBeCloseTo(20, 5)
    expect(widths[widths.length - 1]!).toBeCloseTo(4, 5)
  })

  it('straddles the centreline evenly', () => {
    const pts = points(ribbonPath(horizontal, 'straight', 10, 10, 4))
    // A constant-width ribbon about y=0 puts one side at +5 and the other at -5.
    expect(pts.filter((p) => Math.abs(p.y - 5) < 1e-9)).toHaveLength(5)
    expect(pts.filter((p) => Math.abs(p.y + 5) < 1e-9)).toHaveLength(5)
  })

  it('follows the centreline`s direction, not just the x axis', () => {
    const diagonal: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]
    const pts = points(ribbonPath(diagonal, 'straight', 10, 10, 2))
    // Offsets are perpendicular to a 45-degree line, so each side is displaced
    // by 5/sqrt(2) in x and y.
    const off = 5 / Math.SQRT2
    expect(pts[0]!.x).toBeCloseTo(-off, 1)
    expect(pts[0]!.y).toBeCloseTo(off, 1)
  })

  it('produces no NaN when the path doubles back on itself', () => {
    const doubled: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 0, y: 0 },
    ]
    expect(ribbonPath(doubled, 'elbow', 10, 2, 8)).not.toMatch(/NaN/)
  })

  it('returns an empty path for a degenerate route rather than throwing', () => {
    expect(ribbonPath([{ x: 1, y: 1 }], 'straight')).toBe('')
    expect(
      ribbonPath(
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
        'straight',
      ),
    ).toBe('')
  })

  // A fixed sample count facets visibly on a long connector once the board is
  // zoomed in — the ribbon is inside the world transform and scales with it.
  it('samples a long path more finely than a short one', () => {
    const short = ribbonPath(horizontal, 'straight')
    const long = ribbonPath(
      [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
      ],
      'straight',
    )
    expect(points(long).length).toBeGreaterThan(points(short).length)
  })

  it('defaults to the shared taper widths', () => {
    const d = ribbonPath(horizontal, 'straight', undefined, undefined, 4)
    const pts = points(d)
    expect(Math.abs(pts[0]!.y - pts[pts.length - 1]!.y)).toBeCloseTo(RIBBON_START_W, 5)
    expect(Math.abs(pts[4]!.y - pts[5]!.y)).toBeCloseTo(RIBBON_END_W, 5)
  })
})

describe('arrowPath', () => {
  const coords = (d: string) =>
    [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => ({ x: +m[1]!, y: +m[2]! }))

  it('ends in a head whose point is the connector`s end', () => {
    const d = arrowPath([{ x: 0, y: 0 }, { x: 200, y: 0 }], 'straight')
    const pts = coords(d)
    // Nothing is painted past the target.
    expect(Math.max(...pts.map((p) => p.x))).toBe(200)
    expect(d).toContain('M 200 0')
  })

  it('keeps the line thin and even, with a wider head', () => {
    const pts = coords(arrowPath([{ x: 0, y: 0 }, { x: 200, y: 0 }], 'straight'))
    const nearStart = pts.filter((p) => p.x < 1)
    expect(Math.max(...nearStart.map((p) => Math.abs(p.y)))).toBeCloseTo(ARROW_LINE_W / 2)
    expect(Math.max(...pts.map((p) => Math.abs(p.y)))).toBeCloseTo(ARROW_HEAD_W / 2)
  })

  it('shrinks the head on a very short connector instead of overrunning it', () => {
    const pts = coords(arrowPath([{ x: 0, y: 0 }, { x: 10, y: 0 }], 'straight'))
    expect(Math.min(...pts.map((p) => p.x))).toBeGreaterThanOrEqual(0)
  })

  it('routes as a curve', () => {
    const pts = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 120, y: 200 }, { x: 200, y: 200 }]
    expect(arrowPath(pts, 'arrow')).not.toBe(arrowPath(pts, 'straight'))
  })
})

describe('connectorPath', () => {
  const pts = [{ x: 0, y: 0 }, { x: 200, y: 0 }]
  it('paints arrow as an arrow and everything else as a ribbon', () => {
    expect(connectorPath(pts, 'arrow')).toBe(arrowPath(pts, 'arrow'))
    expect(connectorPath(pts, 'straight')).toBe(ribbonPath(pts, 'straight'))
  })
  it('scales widths for screen-space painters', () => {
    expect(connectorPath(pts, 'straight', 2)).toBe(
      ribbonPath(pts, 'straight', RIBBON_START_W * 2, RIBBON_END_W * 2),
    )
  })
})
