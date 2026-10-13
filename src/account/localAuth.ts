import { readCookie, writeCookie } from './cookie'
import { USERS, getAll, getOne, write, type OpenDb } from './localDb'
import type { AuthProvider, Session, User } from './types'

export const SESSION_COOKIE = 'bb_session'

/** Chrome's ceiling on cookie lifetime. Refreshed on every visit, so it only lapses when idle. */
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type StoredUser = User & { lastSeenAt: number }

/**
 * An anonymous user per browser, with no server.
 *
 * The cookie says who is signed in; the user registry in IndexedDB is the
 * backstop for when it is gone. A cookie set from script lasts at most seven
 * days in Safari, and the boards it points at live in IndexedDB anyway — so
 * as long as the data survives, the most recently seen user is picked back up
 * rather than a stranger minted in front of their own boards.
 */
export function createLocalAuth(open: OpenDb, now: () => number = Date.now): AuthProvider {
  return {
    async start(): Promise<Session> {
      const cookie = readCookie(SESSION_COOKIE)
      const fromCookie = cookie && USER_ID.test(cookie) ? cookie : null

      let user: User | undefined = fromCookie ? await getOne<StoredUser>(open, USERS, fromCookie) : undefined
      // A cookie that outlived its registry entry still names a user; keep the id.
      if (!user && fromCookie) user = { id: fromCookie, kind: 'anonymous', createdAt: now() }
      if (!user) user = mostRecent(await getAll<StoredUser>(open, USERS))
      if (!user) user = { id: uuid(), kind: 'anonymous', createdAt: now() }

      const { id, kind, createdAt } = user
      const stored: StoredUser = { id, kind, createdAt, lastSeenAt: now() }
      await write(open, USERS, (s) => s.put(stored))
      writeCookie(SESSION_COOKIE, id, MAX_AGE_SECONDS)
      return { user: { id, kind, createdAt } }
    },
  }
}

function mostRecent(users: StoredUser[]): StoredUser | undefined {
  return users.reduce<StoredUser | undefined>((best, u) => (!best || u.lastSeenAt > best.lastSeenAt ? u : best), undefined)
}

/**
 * A v4 UUID — the shape Supabase gives its user ids. `crypto.randomUUID` exists
 * only in secure contexts, so a dev server reached over a LAN address falls
 * back to building one from `getRandomValues`, which has no such restriction.
 */
function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
