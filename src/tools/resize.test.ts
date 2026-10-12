import { afterEach, describe, expect, it, vi } from 'vitest'
import { addNode, getNode } from '../document/nodes'
import { createDoc } from '../document/schema'
import { createUndoManager } from '../document/undo'
import { MIN_RESIZE, createResizeTool, resetResizeTool, resizePreview, resizedSize } from './resize'
import type { ToolContext, WorldEvent } from './types'

const start = { x: 0, y: 0, w: 200, h: 100 }

describe('resizedSize', () => {
  it('adds the pointer travel when resizing freely', () => {
    expect(resizedSize(start, 50, 30, null)).toEqual({ w: 250, h: 130 })
  })

  it('holds the proportions when asked', () => {
    expect(resizedSize(start, 100, 0, 2)).toEqual({ w: 300, h: 150 })
    expect(resizedSize(start, 0, 100, 2)).toEqual({ w: 400, h: 200 })
  })

  it('never shrinks below the minimum', () => {
    expect(resizedSize(start, -500, -500, null)).toEqual({ w: MIN_RESIZE, h: MIN_RESIZE })
    const held = resizedSize(start, -500, 0, 2)
    expect(held.h).toBeGreaterThanOrEqual(MIN_RESIZE)
    expect(held.w / held.h).toBeCloseTo(2)
  })
})

describe('resize tool', () => {
  afterEach(() => resetResizeTool())

  const ev = (type: WorldEvent['type'], x: number, y: number, nodeId: string): WorldEvent => ({
    type,
    worldPoint: { x, y },
    screenPoint: { x, y },
    hit: { nodeId, part: 'resize' },
    modifiers: { shift: false, meta: false, alt: false, space: false },
  })

  it('previews while dragging and commits once on release, as one undo step', () => {
    const doc = createDoc()
    const undo = createUndoManager(doc)
    const id = addNode(doc, { type: 'image', x: 0, y: 0, w: 200, h: 100, props: {} }, 'system')
    const ctx = { doc, setSelection: vi.fn() } as unknown as ToolContext
    const tool = createResizeTool(() => true)

    tool.onDown!(ev('down', 200, 100, id), ctx)
    tool.onMove!(ev('move', 300, 100, id), ctx)
    expect(resizePreview()).toEqual({ id, w: 300, h: 150 })
    // Nothing written mid-gesture.
    expect(getNode(doc, id)!.w).toBe(200)

    tool.onUp!(ev('up', 300, 100, id), ctx)
    expect(getNode(doc, id)).toMatchObject({ w: 300, h: 150 })
    expect(resizePreview()).toBeNull()

    undo.undo()
    expect(getNode(doc, id)).toMatchObject({ w: 200, h: 100 })
  })

  it('does nothing for a press that never moved', () => {
    const doc = createDoc()
    const id = addNode(doc, { type: 'image', x: 0, y: 0, w: 200, h: 100, props: {} })
    const ctx = { doc, setSelection: vi.fn() } as unknown as ToolContext
    const tool = createResizeTool(() => false)
    tool.onDown!(ev('down', 200, 100, id), ctx)
    tool.onUp!(ev('up', 200, 100, id), ctx)
    expect(getNode(doc, id)!.w).toBe(200)
  })
})
