import { afterEach, describe, expect, it } from 'vitest'
import { clearCookie, readCookie, writeCookie } from './cookie'
import { SESSION_COOKIE, createLocalAuth } from './localAuth'
import { localDb } from './localDb'

const B = '7b0f6c0e-1f0e-4d43-9a43-0c1f1e2b3c4d'
const freshDb = () =>localDb(`accounts-${Math.random().toString(36).slice(2)}`)

afterEach(() => clearCookie(SESSION_COOKIE))

describe('createLocalAuth', () => {
  it('mints an anonymous user on first visit and remembers it in a cookie', async () => {
    const session = await createLocalAuth(freshDb()).start()
    expect(session.user.kind).toBe('anonymous')
    expect(session.user.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(readCookie(SESSION_COOKIE)).toBe(session.user.id)
  })

  it('hands back the same user on a later visit', async () => {
    const db = freshDb()
    const first = await createLocalAuth(db).start()
    const second = await createLocalAuth(db).start()
    expect(second.user).toEqual(first.user)
  })

  it('recovers the user from the registry when the cookie is gone', async () => {
    // Safari caps cookies set from script at seven days, so losing the cookie
    // while the boards are still on disk is the expected case, not an edge.
    const db = freshDb()
    const first = await createLocalAuth(db).start()
    clearCookie(SESSION_COOKIE)
    const second = await createLocalAuth(db).start()
    expect(second.user.id).toBe(first.user.id)
    expect(readCookie(SESSION_COOKIE)).toBe(first.user.id)
  })

  it('recovers the most recently seen user when there are several', async () => {
    const db = freshDb()
    let t = 1000
    const auth = createLocalAuth(db, () => t)
    const a = await auth.start()
    // A second user in the same registry: one whose cookie arrived from elsewhere.
    t = 2000
    writeCookie(SESSION_COOKIE, B, 60)
    await auth.start()
    clearCookie(SESSION_COOKIE)
    expect((await auth.start()).user.id).toBe(B)

    t = 3000
    writeCookie(SESSION_COOKIE, a.user.id, 60)
    await auth.start()
    clearCookie(SESSION_COOKIE)
    expect((await auth.start()).user.id).toBe(a.user.id)
  })

  it('keeps a cookie user whose registry entry was lost', async () => {
    writeCookie(SESSION_COOKIE, B, 60)
    const session = await createLocalAuth(freshDb()).start()
    expect(session.user.id).toBe(B)
  })

  it('ignores a cookie that is not a user id', async () => {
    writeCookie(SESSION_COOKIE, '<script>', 60)
    const session = await createLocalAuth(freshDb()).start()
    expect(session.user.id).not.toBe('<script>')
    expect(readCookie(SESSION_COOKIE)).toBe(session.user.id)
  })
})
