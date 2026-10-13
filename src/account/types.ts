import type * as Y from 'yjs'
import type { AssetBackend } from '../document/assets'
import type { Persistence } from '../document/persistence'

export type UserId = string
export type BoardId = string

/**
 * Whoever is using the app. Today that is always an anonymous user minted on
 * first visit. Signing in with Google will link an identity to the same user
 * (Supabase's `linkIdentity`) rather than replace it, so the id — and every
 * board owned by it — survives the upgrade.
 */
export type User = {
  id: UserId
  kind: 'anonymous'
  createdAt: number
}

export type Session = { user: User }

export interface AuthProvider {
  /** The current session, minting an anonymous user if there is none yet. */
  start(): Promise<Session>
}

export type BoardRecord = {
  id: BoardId
  ownerId: UserId
  title: string
  createdAt: number
  /** When the board was last opened; the most recent is the one reopened on load. */
  openedAt: number
}

/**
 * Which boards a user owns, and their titles. Not the boards' contents — those
 * are Yjs documents loaded by `Backend.persistBoard`.
 *
 * Every write names its user, and implementations refuse to touch a board the
 * user does not own: that is the shape a Supabase row-level-security policy
 * will enforce on the server.
 */
export interface BoardRepository {
  /** The user's boards, oldest first. */
  list(userId: UserId): Promise<BoardRecord[]>
  create(userId: UserId, title: string): Promise<BoardRecord>
  rename(userId: UserId, boardId: BoardId, title: string): Promise<void>
  markOpened(userId: UserId, boardId: BoardId): Promise<void>
  /** Removes the board and its contents. */
  remove(userId: UserId, boardId: BoardId): Promise<void>
}

/**
 * Everything that decides where data lives. The app is wired to exactly one of
 * these at startup (main.tsx); moving to Supabase is a second implementation of
 * this type, not a change to the code that uses it.
 */
export type Backend = {
  auth: AuthProvider
  boards: BoardRepository
  /** Loads a board's document into `doc` and keeps it saved. */
  persistBoard: (doc: Y.Doc, boardId: BoardId) => Persistence
  assets: AssetBackend
}
