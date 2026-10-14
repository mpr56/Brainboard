import type * as Y from 'yjs'
import type { AssetBackend } from '../document/assets'
import type { Persistence } from '../document/persistence'

export type UserId = string
export type BoardId = string

/**
 * Whoever is using the app. Every visit starts as an anonymous user; signing in
 * with Google (cloud backend only) makes a *different* user — Better Auth does
 * not keep the anonymous id — and the server moves the anonymous user's boards
 * to it in the same step, so nothing is lost but the id changes.
 */
export type User = {
  id: UserId
  kind: 'anonymous' | 'google'
  createdAt: number
  email?: string
  name?: string
}

export type Session = { user: User }

export interface AuthProvider {
  /** The current session, minting an anonymous user if there is none yet. */
  start(): Promise<Session>
  /** Leaves the page for Google's sign-in, coming back signed in. Absent where unsupported. */
  signInWithGoogle?: () => Promise<void>
}

export type BoardRecord = {
  id: BoardId
  ownerId: UserId
  title: string
  createdAt: number
  /** When the board was last opened; the most recent is the one reopened on load. */
  openedAt: number
}

/** What a home-screen card shows of a board without opening it. */
export type BoardPreview = {
  /** A small picture of the board; null for an empty board. */
  image: Blob | null
  /** Text nodes on the board. */
  nodes: number
  /** Media nodes on the board. */
  media: number
  savedAt: number
}

/**
 * Which boards a user owns, and their titles. Not the boards' contents — those
 * are Yjs documents loaded by `Backend.persistBoard`.
 *
 * Every write names its user, and implementations refuse to touch a board the
 * user does not own — the same rule the cloud Worker applies from the session
 * (worker/src/boards.ts).
 */
export interface BoardRepository {
  /** The user's boards, oldest first. */
  list(userId: UserId): Promise<BoardRecord[]>
  create(userId: UserId, title: string): Promise<BoardRecord>
  rename(userId: UserId, boardId: BoardId, title: string): Promise<void>
  markOpened(userId: UserId, boardId: BoardId): Promise<void>
  /** Removes the board, its contents and its preview. */
  remove(userId: UserId, boardId: BoardId): Promise<void>
  savePreview(userId: UserId, boardId: BoardId, preview: Omit<BoardPreview, 'savedAt'>): Promise<void>
  getPreview(userId: UserId, boardId: BoardId): Promise<BoardPreview | null>
}

/**
 * Everything that decides where data lives. The app is wired to exactly one of
 * these at startup (main.tsx): the in-browser one, or the Cloudflare one in
 * account/cloud/. The code that uses it doesn't know which.
 */
export type Backend = {
  auth: AuthProvider
  boards: BoardRepository
  /** Loads a board's document into `doc` and keeps it saved. */
  persistBoard: (doc: Y.Doc, boardId: BoardId) => Persistence
  assets: AssetBackend
  /** Copies boards made in this browser before the cloud backend into the account. Cloud only. */
  importLocal?: {
    find(): Promise<BoardRecord[]>
    run(userId: UserId, boards: BoardRecord[]): Promise<number>
  }
}
