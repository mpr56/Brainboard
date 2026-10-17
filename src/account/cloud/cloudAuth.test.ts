import { describe, expect, it, vi } from 'vitest'
import { createCloudAuth, type AuthClient } from './cloudAuth'

const anonUser = { id: 'u1', createdAt: '2026-10-01T00:00:00.000Z', isAnonymous: true, email: 'x@anonymous.invalid', name: 'Anonymous' }

function client(session: unknown, signedIn: unknown = { data: { user: anonUser }, error: null }) {
  return {
    getSession: vi.fn().mockResolvedValue({ data: session, error: null }),
    signIn: { anonymous: vi.fn().mockResolvedValue(signedIn), social: vi.fn().mockResolvedValue({}) },
  } satisfies AuthClient
}

describe('createCloudAuth', () => {
  it('returns the existing session’s user', async () => {
    const c = client({ user: { ...anonUser, id: 'g1', isAnonymous: false, email: 'a@b.c', name: 'Ada' } })
    const { user } = await createCloudAuth(c).start()
    expect(user).toEqual({ id: 'g1', kind: 'google', createdAt: Date.parse(anonUser.createdAt), email: 'a@b.c', name: 'Ada' })
    expect(c.signIn.anonymous).not.toHaveBeenCalled()
  })

  it('signs in anonymously when there is no session, hiding the placeholder email', async () => {
    const c = client(null)
    const { user } = await createCloudAuth(c).start()
    expect(user).toEqual({ id: 'u1', kind: 'anonymous', createdAt: Date.parse(anonUser.createdAt) })
  })

  it('does not replace a session it merely failed to read', async () => {
    const c = client(null)
    c.getSession.mockResolvedValue({ data: null, error: { message: 'Server error', status: 500 } })
    await expect(createCloudAuth(c).start()).rejects.toThrow('Server error')
    expect(c.signIn.anonymous).not.toHaveBeenCalled()
  })

  it('surfaces a failed anonymous sign-in', async () => {
    const c = client(null, { data: null, error: { message: 'nope' } })
    await expect(createCloudAuth(c).start()).rejects.toThrow('nope')
  })

  it('sends Google sign-in back to the app', async () => {
    const c = client(null)
    await createCloudAuth(c).signInWithGoogle!()
    expect(c.signIn.social).toHaveBeenCalledWith({ provider: 'google', callbackURL: `${location.origin}/` })
  })
})
