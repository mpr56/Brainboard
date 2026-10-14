import { describe, expect, it } from 'vitest'
import type { Node } from '../types'
import { THUMB_H, THUMB_W, previewCounts, thumbnailView } from './thumbnail'

const node = (over: Partial<Node>): Node => ({
  id: Math.random().toString(36),
  type: 'text',
  x: 0,
  y: 0,
  w: 220,
  h: 60,
  z: 0,
  parent: null,
  props: {},
  ...over,
})

describe('thumbnailView', () => {
  it('has nothing to show for an empty board', () => {
    expect(thumbnailView([])).toBeNull()
  })

  it('frames the thumbnail’s own shape, centred on the content', () => {
    const v = thumbnailView([node({ x: 0, y: 0, w: 4000, h: 300 })])!
    expect(v.frame.w / v.frame.h).toBeCloseTo(THUMB_W / THUMB_H)
    expect(v.frame.x + v.frame.w / 2).toBeCloseTo(2000)
    expect(v.frame.y + v.frame.h / 2).toBeCloseTo(150)
    expect(v.frame.w * v.scale).toBeCloseTo(THUMB_W)
  })

  it('fits a tall board by its height', () => {
    const v = thumbnailView([node({ x: 0, y: 0, w: 200, h: 3000 })])!
    expect(v.frame.h).toBeGreaterThanOrEqual(3000)
    expect(v.frame.h * v.scale).toBeCloseTo(THUMB_H)
  })

  it('does not blow a lone node up past its real size', () => {
    const v = thumbnailView([node({ x: 100, y: 100 })])!
    expect(v.scale).toBe(1)
    expect(v.frame).toMatchObject({ w: THUMB_W, h: THUMB_H })
  })
})

describe('previewCounts', () => {
  it('counts text and media nodes apart', () => {
    expect(
      previewCounts([node({ type: 'text' }), node({ type: 'text' }), node({ type: 'video' }), node({ type: 'image' })]),
    ).toEqual({ nodes: 2, media: 2 })
  })
})
