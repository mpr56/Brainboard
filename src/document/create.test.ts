import { describe, expect, it } from 'vitest'
import { listEdges } from './edges'
import { getNode, listNodes, addNode } from './nodes'
import { createDoc } from './schema'
import { createUndoManager } from './undo'
import { NEW_NODE_TEXT, createNodeAt } from './create'
import { BRANCH_PALETTE } from './palette'

const size = { w: 200, h: 80 }

describe('createNodeAt', () => {
  it('centres the new node on the given point', () => {
    const doc = createDoc()
    const id = createNodeAt(doc, { x: 500, y: 300 }, { size })
    expect(getNode(doc, id)).toMatchObject({ x: 400, y: 260, w: 200, h: 80 })
  })

  // The prompt is a placeholder the view paints, not stored text — otherwise
  // typing into a new node appends to "New idea" rather than replacing it.
  it('starts empty rather than storing the prompt as text', () => {
    const doc = createDoc()
    const id = createNodeAt(doc, { x: 0, y: 0 }, { size })
    expect(getNode(doc, id)!.props.text).toBe('')
    expect(getNode(doc, id)!.props.text).not.toBe(NEW_NODE_TEXT)
  })

  it('accepts explicit text', () => {
    const doc = createDoc()
    const id = createNodeAt(doc, { x: 0, y: 0 }, { size, text: 'given' })
    expect(getNode(doc, id)!.props.text).toBe('given')
  })

  it('creates no edge when there is nothing to link from', () => {
    const doc = createDoc()
    createNodeAt(doc, { x: 0, y: 0 }, { size })
    expect(listEdges(doc)).toHaveLength(0)
  })

  it('links from the given anchor to the new node', () => {
    const doc = createDoc()
    const parent = addNode(doc, { type: 'text', x: 0, y: 0, w: 100, h: 50, props: {} })
    const id = createNodeAt(doc, { x: 400, y: 0 }, { size, from: { nodeId: parent } })

    const edges = listEdges(doc)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ from: { nodeId: parent }, to: { nodeId: id } })
  })

  it('carries the anchor locator through, so a timestamp link starts on the scrubber', () => {
    const doc = createDoc()
    const parent = addNode(doc, { type: 'text', x: 0, y: 0, w: 100, h: 50, props: {} })
    createNodeAt(doc, { x: 400, y: 0 }, {
      size,
      from: { nodeId: parent, locator: { kind: 'time', t: 12 } },
    })
    expect(listEdges(doc)[0]!.from.locator).toEqual({ kind: 'time', t: 12 })
  })

  it('creates the edge with the requested routing style', () => {
    const doc = createDoc()
    const parent = addNode(doc, { type: 'text', x: 0, y: 0, w: 100, h: 50, props: {} })
    createNodeAt(doc, { x: 400, y: 0 }, { size, from: { nodeId: parent }, edgeStyleKind: 'elbow' })
    expect(listEdges(doc)[0]!.style).toEqual({
      kind: 'elbow',
      arrow: 'end',
      // A node with nothing pointing at it starts a new branch, so its first
      // connector opens the palette.
      color: BRANCH_PALETTE[0],
    })
  })

  it('gives a child the branch colour of the connector that reached its parent', () => {
    const doc = createDoc()
    const root = addNode(doc, { type: 'text', x: 0, y: 0, w: 100, h: 50, props: {} })
    const mid = createNodeAt(doc, { x: 400, y: 0 }, { size, from: { nodeId: root } })
    const grandchildEdgeBefore = listEdges(doc).length

    createNodeAt(doc, { x: 800, y: 0 }, { size, from: { nodeId: mid } })
    const [first, second] = listEdges(doc)
    expect(listEdges(doc)).toHaveLength(grandchildEdgeBefore + 1)
    expect(second!.style.color).toBe(first!.style.color)
  })

  it('gives each branch off the same parent its own colour', () => {
    const doc = createDoc()
    const root = addNode(doc, { type: 'text', x: 0, y: 0, w: 100, h: 50, props: {} })
    createNodeAt(doc, { x: 400, y: -200 }, { size, from: { nodeId: root } })
    createNodeAt(doc, { x: 400, y: 200 }, { size, from: { nodeId: root } })

    const [a, b] = listEdges(doc)
    expect(a!.style.color).toBe(BRANCH_PALETTE[0])
    expect(b!.style.color).toBe(BRANCH_PALETTE[1])
  })

  // The reason this helper exists at all. addNode and addEdge each open their
  // own transaction; run back to back they produce two undo entries, so
  // spawning a child off a handle would take two presses of Cmd-Z and the
  // first would leave an edge pointing at a node that no longer exists.
  it('creates the node and its edge as exactly one undo step', () => {
    const doc = createDoc()
    const parent = addNode(doc, { type: 'text', x: 0, y: 0, w: 100, h: 50, props: {} })
    const undo = createUndoManager(doc)

    createNodeAt(doc, { x: 400, y: 0 }, { size, from: { nodeId: parent } })
    expect(listNodes(doc)).toHaveLength(2)
    expect(listEdges(doc)).toHaveLength(1)

    undo.undo()
    expect(listNodes(doc)).toHaveLength(1)
    expect(listEdges(doc)).toHaveLength(0)
    expect(undo.canUndo()).toBe(false)
  })

  it('restores both halves on redo', () => {
    const doc = createDoc()
    const parent = addNode(doc, { type: 'text', x: 0, y: 0, w: 100, h: 50, props: {} })
    const undo = createUndoManager(doc)

    createNodeAt(doc, { x: 400, y: 0 }, { size, from: { nodeId: parent } })
    undo.undo()
    undo.redo()

    expect(listNodes(doc)).toHaveLength(2)
    expect(listEdges(doc)).toHaveLength(1)
  })

  it('stacks above existing nodes', () => {
    const doc = createDoc()
    addNode(doc, { type: 'text', x: 0, y: 0, w: 100, h: 50, props: {} })
    const id = createNodeAt(doc, { x: 0, y: 0 }, { size })
    const [, top] = listNodes(doc)
    expect(top!.id).toBe(id)
  })

  // A 'system' write must stay out of the undo stack, or a derived creation
  // would put an entry there that the user never asked for.
  it('honours a non-user origin', () => {
    const doc = createDoc()
    const undo = createUndoManager(doc)
    createNodeAt(doc, { x: 0, y: 0 }, { size }, 'system')
    expect(listNodes(doc)).toHaveLength(1)
    expect(undo.canUndo()).toBe(false)
  })
})
