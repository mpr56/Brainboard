import { afterEach, describe, expect, it } from 'vitest'
import { clearCookie, readCookie, writeCookie } from './cookie'

afterEach(() => {
  clearCookie('a')
  clearCookie('b')
})

describe('cookie', () => {
  it('reads back what was written', () => {
    writeCookie('a', 'one', 60)
    expect(readCookie('a')).toBe('one')
  })

  it('returns null for a cookie that is not set', () => {
    expect(readCookie('missing')).toBeNull()
  })

  it('tells cookies with similar names apart', () => {
    writeCookie('a', 'one', 60)
    writeCookie('b', 'two', 60)
    expect(readCookie('a')).toBe('one')
    expect(readCookie('b')).toBe('two')
  })

  it('round-trips values that need encoding', () => {
    writeCookie('a', 'x y;z=1', 60)
    expect(readCookie('a')).toBe('x y;z=1')
  })

  it('clears a cookie', () => {
    writeCookie('a', 'one', 60)
    clearCookie('a')
    expect(readCookie('a')).toBeNull()
  })
})
