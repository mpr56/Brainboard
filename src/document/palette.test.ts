import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '../types'
import {
  BRANCH_PALETTE,
  LEGACY_EDGE_COLOR,
  branchColor,
  branchEdgeStyle,
  resolveEdgeColors,
  resolveNodeColors,
  tint,
} from './palette'
import { addEdge } from './edges'
import { addNode } from './nodes'
import { createDoc } from './schema'

const node = (doc: ReturnType<typeof createDoc>, x = 0) =>
  addNode(doc, { type: 'text', x, y: 0, w: 100, h: 40, props: {} })

describe('branchColor', () => {
  it('starts a root`s first branch on the first palette colour', () => {
    const doc = createDoc()
    expect(branchColor(doc, node(doc))).toBe(BRANCH_PALETTE[0])
  })

  it('gives each branch off the same root a different colour', () => {
    const doc = createDoc()
    const root = node(doc)
    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      const child = node(doc, 100 * (i + 1))
      const color = branchColor(doc, root)
      seen.push(color)
      addEdge(doc, { from: { nodeId: root }, to: { nodeId: child }, style: { color } })
    }
    expect(seen).toEqual([BRANCH_PALETTE[0], BRANCH_PALETTE[1], BRANCH_PALETTE[2]])
  })

  // The rule a mind map is read by: one colour all the way out from the trunk.
  it('inherits the colour of the connector that arrived at the source', () => {
    const doc = createDoc()
    const root = node(doc)
    const mid = node(doc, 200)
    addEdge(doc, {
      from: { nodeId: root },
      to: { nodeId: mid },
      style: { color: BRANCH_PALETTE[4] },
    })
    expect(branchColor(doc, mid)).toBe(BRANCH_PALETTE[4])
  })

  it('carries a colour down several generations', () => {
    const doc = createDoc()
    let prev = node(doc)
    addEdge(doc, {
      from: { nodeId: prev },
      to: { nodeId: (prev = node(doc, 200)) },
      style: { color: BRANCH_PALETTE[2] },
    })
    for (let depth = 0; depth < 3; depth++) {
      const color = branchColor(doc, prev)
      expect(color).toBe(BRANCH_PALETTE[2])
      const next = node(doc, 400 + depth * 200)
      addEdge(doc, { from: { nodeId: prev }, to: { nodeId: next }, style: { color } })
      prev = next
    }
  })

  // Siblings share their parent's colour, unlike siblings off a root.
  it('does not start new colours partway down a branch', () => {
    const doc = createDoc()
    const root = node(doc)
    const mid = node(doc, 200)
    addEdge(doc, {
      from: { nodeId: root },
      to: { nodeId: mid },
      style: { color: BRANCH_PALETTE[3] },
    })
    const first = branchColor(doc, mid)
    addEdge(doc, {
      from: { nodeId: mid },
      to: { nodeId: node(doc, 400) },
      style: { color: first },
    })
    expect(branchColor(doc, mid)).toBe(first)
  })

  it('wraps round the palette rather than running out', () => {
    const doc = createDoc()
    const root = node(doc)
    for (let i = 0; i < BRANCH_PALETTE.length; i++) {
      const color = branchColor(doc, root)
      addEdge(doc, {
        from: { nodeId: root },
        to: { nodeId: node(doc, 100 * (i + 1)) },
        style: { color },
      })
    }
    expect(branchColor(doc, root)).toBe(BRANCH_PALETTE[0])
  })

  // Read from document state rather than a module counter, so two clients
  // building the same structure independently agree on its colours.
  it('is a pure function of the document, not of call order', () => {
    const build = () => {
      const doc = createDoc()
      const root = node(doc)
      const a = node(doc, 200)
      addEdge(doc, {
        from: { nodeId: root },
        to: { nodeId: a },
        style: { color: branchColor(doc, root) },
      })
      return branchColor(doc, root)
    }
    expect(build()).toBe(build())
  })
})

describe('branchEdgeStyle', () => {
  it('pairs the chosen routing with the branch colour', () => {
    const doc = createDoc()
    expect(branchEdgeStyle(doc, node(doc), 'elbow')).toEqual({
      kind: 'elbow',
      color: BRANCH_PALETTE[0],
    })
  })
})

describe('resolveEdgeColors', () => {
  const n = (id: string, props: Record<string, unknown> = {}): Node => ({
    id, type: 'text', x: 0, y: 0, w: 100, h: 40, z: 1, parent: null, props,
  })
  const e = (id: string, from: string, to: string, color: string = LEGACY_EDGE_COLOR): Edge => ({
    id,
    from: { nodeId: from },
    to: { nodeId: to },
    style: { kind: 'curve', arrow: 'end', color },
  })

  // Boards from before branch colours stored every connector as black, and the
  // inheritance rule then copied that black onto everything grown off them.
  it('ignores the legacy black and gives an old board palette colours', () => {
    const colors = resolveEdgeColors(
      [n('r'), n('a'), n('b'), n('c')],
      [e('ra', 'r', 'a'), e('rb', 'r', 'b'), e('ac', 'a', 'c')],
    )
    expect(colors.get('ra')).toBe(BRANCH_PALETTE[0])
    expect(colors.get('rb')).toBe(BRANCH_PALETTE[1])
    expect(colors.get('ac')).toBe(BRANCH_PALETTE[0])
  })

  it('keeps the colour stored on a root`s connector', () => {
    const colors = resolveEdgeColors([n('r'), n('a')], [e('ra', 'r', 'a', BRANCH_PALETTE[5])])
    expect(colors.get('ra')).toBe(BRANCH_PALETTE[5])
  })

  it('follows the branch downstream rather than what each edge stored', () => {
    const colors = resolveEdgeColors(
      [n('r'), n('a'), n('b')],
      [e('ra', 'r', 'a', BRANCH_PALETTE[2]), e('ab', 'a', 'b', BRANCH_PALETTE[6])],
    )
    expect(colors.get('ab')).toBe(BRANCH_PALETTE[2])
  })

  it('paints the connector into a coloured node, and everything below it', () => {
    const colors = resolveEdgeColors(
      [n('r'), n('a', { color: '#123456' }), n('b'), n('c')],
      [e('ra', 'r', 'a'), e('ab', 'a', 'b'), e('bc', 'b', 'c'), e('rb2', 'r', 'c')],
    )
    expect(colors.get('ra')).toBe('#123456')
    expect(colors.get('ab')).toBe('#123456')
    expect(colors.get('bc')).toBe('#123456')
  })

  it('lets a coloured node further down take over from its ancestor', () => {
    const colors = resolveEdgeColors(
      [n('r', { color: '#111111' }), n('a'), n('b', { color: '#222222' }), n('c')],
      [e('ra', 'r', 'a'), e('ab', 'a', 'b'), e('bc', 'b', 'c')],
    )
    expect(colors.get('ra')).toBe('#111111')
    expect(colors.get('ab')).toBe('#222222')
    expect(colors.get('bc')).toBe('#222222')
  })

  it('ignores a colour prop that is not a hex colour', () => {
    const colors = resolveEdgeColors(
      [n('r'), n('a', { color: 'url(javascript:alert(1))' })],
      [e('ra', 'r', 'a')],
    )
    expect(colors.get('ra')).toBe(BRANCH_PALETTE[0])
  })

  it('terminates on a loop with no root in it', () => {
    const colors = resolveEdgeColors(
      [n('a'), n('b')],
      [e('ab', 'a', 'b', BRANCH_PALETTE[3]), e('ba', 'b', 'a', BRANCH_PALETTE[4])],
    )
    expect(colors.size).toBe(2)
  })

  // The reported bug: a hub with three coloured branches went all one colour
  // the moment one of its children was linked back into it, because the hub
  // stopped being a root and every branch inherited the new arrival.
  it('keeps a hub`s branches distinct when something is linked into it later', () => {
    const colors = resolveEdgeColors(
      [n('hub'), n('a'), n('b'), n('c')],
      [
        e('ha', 'hub', 'a', BRANCH_PALETTE[0]),
        e('hb', 'hub', 'b', BRANCH_PALETTE[1]),
        e('hc', 'hub', 'c', BRANCH_PALETTE[2]),
        e('bh', 'b', 'hub', BRANCH_PALETTE[1]),
      ],
    )
    expect(colors.get('ha')).toBe(BRANCH_PALETTE[0])
    expect(colors.get('hb')).toBe(BRANCH_PALETTE[1])
    expect(colors.get('hc')).toBe(BRANCH_PALETTE[2])
    // The new link carries the colour of the branch it leaves from.
    expect(colors.get('bh')).toBe(BRANCH_PALETTE[1])
  })

  it('keeps a hub`s branches when a separate tree is linked into it', () => {
    const colors = resolveEdgeColors(
      [n('hub'), n('a'), n('b'), n('other'), n('x')],
      [
        e('ha', 'hub', 'a', BRANCH_PALETTE[0]),
        e('hb', 'hub', 'b', BRANCH_PALETTE[1]),
        e('ox', 'other', 'x', BRANCH_PALETTE[4]),
        e('xh', 'x', 'hub', BRANCH_PALETTE[4]),
      ],
    )
    expect(colors.get('ha')).toBe(BRANCH_PALETTE[0])
    expect(colors.get('hb')).toBe(BRANCH_PALETTE[1])
    expect(colors.get('xh')).toBe(BRANCH_PALETTE[4])
  })

  it('still lets a leaf linked into first and grown from later inherit', () => {
    const colors = resolveEdgeColors(
      [n('r'), n('a'), n('b')],
      [e('ra', 'r', 'a', BRANCH_PALETTE[3]), e('ab', 'a', 'b', BRANCH_PALETTE[0])],
    )
    expect(colors.get('ab')).toBe(BRANCH_PALETTE[3])
  })

  it('paints a link with its own colour, and the branch below it', () => {
    const colors = resolveEdgeColors(
      [n('r'), n('a'), n('b')],
      [{ ...e('ra', 'r', 'a', BRANCH_PALETTE[0]), color: '#123456' }, e('ab', 'a', 'b')],
    )
    expect(colors.get('ra')).toBe('#123456')
    expect(colors.get('ab')).toBe('#123456')
  })

  it('lets a link`s own colour win over the colour of the node it arrives at', () => {
    const colors = resolveEdgeColors(
      [n('r'), n('a', { color: '#222222' })],
      [{ ...e('ra', 'r', 'a'), color: '#123456' }],
    )
    expect(colors.get('ra')).toBe('#123456')
  })
})

describe('resolveNodeColors', () => {
  const n = (id: string, props: Record<string, unknown> = {}): Node => ({
    id, type: 'text', x: 0, y: 0, w: 100, h: 40, z: 1, parent: null, props,
  })
  const e = (id: string, from: string, to: string, color: string): Edge => ({
    id,
    from: { nodeId: from },
    to: { nodeId: to },
    style: { kind: 'curve', arrow: 'end', color },
  })

  it('gives a node the colour of the branch that arrives at it', () => {
    const nodes = [n('r'), n('a'), n('b')]
    const edges = [e('ra', 'r', 'a', BRANCH_PALETTE[0]), e('rb', 'r', 'b', BRANCH_PALETTE[1])]
    const colors = resolveNodeColors(nodes, edges, resolveEdgeColors(nodes, edges))
    expect(colors.get('a')).toBe(BRANCH_PALETTE[0])
    expect(colors.get('b')).toBe(BRANCH_PALETTE[1])
  })

  it('leaves a root uncoloured, since its branches all differ', () => {
    const nodes = [n('r'), n('a')]
    const edges = [e('ra', 'r', 'a', BRANCH_PALETTE[0])]
    expect(resolveNodeColors(nodes, edges, resolveEdgeColors(nodes, edges)).has('r')).toBe(false)
  })

  it('uses a node`s own colour, root or not', () => {
    const nodes = [n('r', { color: '#abcdef' })]
    expect(resolveNodeColors(nodes, [], new Map()).get('r')).toBe('#abcdef')
  })

  it('does not recolour a hub that something was linked into later', () => {
    const nodes = [n('hub'), n('a'), n('b')]
    const edges = [e('ha', 'hub', 'a', BRANCH_PALETTE[0]), e('bh', 'b', 'hub', BRANCH_PALETTE[0])]
    expect(resolveNodeColors(nodes, edges, resolveEdgeColors(nodes, edges)).has('hub')).toBe(false)
  })
})

describe('branchColor with node colours', () => {
  it('passes a node`s own colour on to a new connector', () => {
    const doc = createDoc()
    const root = addNode(doc, { type: 'text', x: 0, y: 0, w: 100, h: 40, props: { color: '#abcdef' } })
    expect(branchColor(doc, root)).toBe('#abcdef')
  })

  it('starts a new colour off a hub that already had branches when linked into', () => {
    const doc = createDoc()
    const hub = node(doc)
    const a = node(doc, 200)
    const b = node(doc, 400)
    addEdge(doc, { from: { nodeId: hub }, to: { nodeId: a }, style: { color: BRANCH_PALETTE[0] } })
    addEdge(doc, { from: { nodeId: b }, to: { nodeId: hub }, style: { color: BRANCH_PALETTE[5] } })
    expect(branchColor(doc, hub)).toBe(BRANCH_PALETTE[1])
  })

  it('does not inherit the legacy black from an old connector', () => {
    const doc = createDoc()
    const root = node(doc)
    const mid = node(doc, 200)
    addEdge(doc, { from: { nodeId: root }, to: { nodeId: mid } })
    expect(branchColor(doc, mid)).toBe(BRANCH_PALETTE[0])
  })
})

describe('tint', () => {
  it('mixes a colour into the card colour', () => {
    expect(tint('#000000', 0, '#ffffff')).toBe('#ffffff')
    expect(tint('#000000', 1, '#ffffff')).toBe('#000000')
    expect(tint('#000000', 0.5, '#ffffff')).toBe('#808080')
  })
})
