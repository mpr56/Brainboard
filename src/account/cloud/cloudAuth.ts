import { createAuthClient } from 'better-auth/client'
import { anonymousClient } from 'better-auth/client/plugins'
import type { AuthProvider, Session, User } from '../types'

type AuthUser = { id: string; createdAt: string | Date; isAnonymous?: boolean | null; email?: string; name?: string }
type Result<T> = { data: T | null; error: { message?: string } | null }

/** The slice of Better Auth's client this app uses — narrow so tests can stand it in. */
export type AuthClient = {
  getSession(): Promise<Result<{ user: AuthUser }>>
  signIn: {
    anonymous(): Promise<Result<{ user: AuthUser }>>
    social(opts: { provider: 'google'; callbackURL: string }): Promise<unknown>
  }
}

const defaultClient = (): AuthClient => createAuthClient({ plugins: [anonymousClient()] }) as unknown as AuthClient

function toUser(u: AuthUser): User {
  const createdAt = new Date(u.createdAt).getTime()
  // An anonymous user's email is a generated placeholder; never show it.
  if (u.isAnonymous) return { id: u.id, kind: 'anonymous', createdAt }
  return { id: u.id, kind: 'google', createdAt, email: u.email, name: u.name }
}

export function createCloudAuth(client: AuthClient = defaultClient()): AuthProvider {
  return {
    async start(): Promise<Session> {
      const existing = await client.getSession()
      if (existing.data?.user) return { user: toUser(existing.data.user) }
      // Better Auth reports failures in `error` rather than throwing. A session
      // that couldn't be read (a 5xx, say) is not "no session": minting an
      // anonymous user here would sign a Google user out of their boards.
      if (existing.error) throw new Error(existing.error.message ?? 'Could not read the session.')
      const made = await client.signIn.anonymous()
      if (!made.data) throw new Error(made.error?.message ?? 'Could not start a session.')
      return { user: toUser(made.data.user) }
    },
    async signInWithGoogle() {
      await client.signIn.social({ provider: 'google', callbackURL: `${location.origin}/` })
    },
  }
}
