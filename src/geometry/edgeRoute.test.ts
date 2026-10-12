import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '../types'
import { pickEdge, routeFor, routeMidpoint } from './edgeRoute'

const node = (id: string, x: number, y = 0): Node => ({
  id, type: 'text', x, y, w: 100, h: 50, z: 1, parent: null, props: {},
})
const edge = (id: string, from: string, to: string): Edge => ({
  id,
  from: { nodeId: from },
  to: { nodeId: to },
  style: { kind: 'straight', arrow: 'end', color: '#000000' },
})

const byId = new Map([
  ['a', node('a', 0)],
  ['b', node('b', 400)],
  ['c', node('c', 0, 300)],
])

describe('routeFor', () => {
  it('runs border to border on the facing sides', () => {
    const r = routeFor(edge('ab', 'a', 'b'), byId)!
    expect(r.points[0]).toEqual({ x: 100, y: 25 })
    expect(r.points.at(-1)).toEqual({ x: 400, y: 25 })
  })

  it('is null when an end is missing', () => {
    expect(routeFor(edge('ax', 'a', 'x'), byId)).toBeNull()
  })

  it('uses the board style over the stored one', () => {
    expect(routeFor(edge('ab', 'a', 'b'), byId, 'curve')!.kind).toBe('curve')
  })
})

describe('routeMidpoint', () => {
  it('is halfway along the line', () => {
    expect(routeMidpoint(routeFor(edge('ab', 'a', 'b'), byId)!)).toEqual({ x: 250, y: 25 })
  })
})

describe('pickEdge', () => {
  const routes = [routeFor(edge('ab', 'a', 'b'), byId)!, routeFor(edge('ac', 'a', 'c'), byId)!]

  it('finds the link under the pointer', () => {
    expect(pickEdge(routes, { x: 250, y: 28 }, 8)).toBe('ab')
    expect(pickEdge(routes, { x: 52, y: 180 }, 8)).toBe('ac')
  })

  it('finds nothing away from every link', () => {
    expect(pickEdge(routes, { x: 250, y: 120 }, 8)).toBeNull()
  })

  it('picks the nearer of two links', () => {
    expect(pickEdge(routes, { x: 110, y: 30 }, 50)).toBe('ab')
  })
})
