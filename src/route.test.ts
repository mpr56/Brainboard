import { describe, expect, it } from 'vitest'
import { parseRoute, routeHash } from './route'

describe('parseRoute', () => {
  it('reads home from an empty or root hash', () => {
    expect(parseRoute('')).toEqual({ page: 'home' })
    expect(parseRoute('#')).toEqual({ page: 'home' })
    expect(parseRoute('#/')).toEqual({ page: 'home' })
  })

  it('reads a board', () => {
    expect(parseRoute('#/b/k3x9_-Ab')).toEqual({ page: 'board', boardId: 'k3x9_-Ab' })
  })

  it('treats anything else as home', () => {
    expect(parseRoute('#/b/')).toEqual({ page: 'home' })
    expect(parseRoute('#/nope')).toEqual({ page: 'home' })
    expect(parseRoute('#/b/has space')).toEqual({ page: 'home' })
  })

  it('round-trips through routeHash', () => {
    for (const r of [{ page: 'home' }, { page: 'board', boardId: 'default' }] as const) {
      expect(parseRoute(routeHash(r))).toEqual(r)
    }
  })
})
