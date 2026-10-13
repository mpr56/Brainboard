import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Backend, BoardId, BoardRecord, User } from './types'

export const NEW_BOARD_TITLE = 'Untitled board'

export type Account = {
  user: User
  /** Oldest first. Never empty. */
  boards: BoardRecord[]
  currentBoard: BoardRecord
  backend: Backend
  openBoard: (id: BoardId) => Promise<void>
  /** Creates a board and opens it. */
  createBoard: (title?: string) => Promise<BoardRecord>
  renameBoard: (id: BoardId, title: string) => Promise<void>
  /** Deletes a board, opening another first if it was the open one. */
  deleteBoard: (id: BoardId) => Promise<void>
}

type Loaded = { user: User; boards: BoardRecord[]; currentId: BoardId }

const AccountContext = createContext<Account | null>(null)

export function useAccount(): Account {
  const account = useContext(AccountContext)
  if (!account) throw new Error('useAccount must be used inside <AccountProvider>.')
  return account
}

async function load(backend: Backend): Promise<Loaded> {
  const { user } = await backend.auth.start()
  let boards = await backend.boards.list(user.id)
  if (boards.length === 0) boards = [await backend.boards.create(user.id, NEW_BOARD_TITLE)]
  return { user, boards, currentId: mostRecentlyOpened(boards).id }
}

const mostRecentlyOpened = (boards: BoardRecord[]) =>
  boards.reduce((a, b) => (b.openedAt > a.openedAt ? b : a))

/**
 * Starts the session, loads the user's boards, and renders `children` only
 * once there is a board to open — so nothing below ever sees "no user".
 */
export function AccountProvider({ backend, children }: { backend: Backend; children: React.ReactNode }) {
  const [state, setState] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(state)
  latest.current = state

  // One load per backend, shared by StrictMode's second effect run. Two
  // concurrent starts on a fresh browser would each mint a user, and the
  // discarded one could walk off with the pre-accounts board.
  const loading = useRef<{ backend: Backend; promise: Promise<Loaded> } | null>(null)

  useEffect(() => {
    if (loading.current?.backend !== backend) loading.current = { backend, promise: load(backend) }
    let alive = true
    loading.current.promise.then(
      (loaded) => alive && setState(loaded),
      (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)),
    )
    return () => {
      alive = false
    }
  }, [backend])

  const openBoard = useCallback(
    async (id: BoardId) => {
      const s = latest.current
      if (!s) return
      const t = Date.now()
      setState({ ...s, currentId: id, boards: s.boards.map((b) => (b.id === id ? { ...b, openedAt: t } : b)) })
      await backend.boards.markOpened(s.user.id, id)
    },
    [backend],
  )

  const createBoard = useCallback(
    async (title = NEW_BOARD_TITLE) => {
      const s = latest.current
      if (!s) throw new Error('No session yet.')
      const board = await backend.boards.create(s.user.id, title)
      setState((prev) => prev && { ...prev, boards: [...prev.boards, board], currentId: board.id })
      return board
    },
    [backend],
  )

  const renameBoard = useCallback(
    async (id: BoardId, title: string) => {
      const s = latest.current
      const trimmed = title.trim()
      if (!s || !trimmed) return
      await backend.boards.rename(s.user.id, id, trimmed)
      setState((prev) => prev && { ...prev, boards: prev.boards.map((b) => (b.id === id ? { ...b, title: trimmed } : b)) })
    },
    [backend],
  )

  const deleteBoard = useCallback(
    async (id: BoardId) => {
      const s = latest.current
      if (!s) return
      let rest = s.boards.filter((b) => b.id !== id)
      if (rest.length === 0) rest = [await backend.boards.create(s.user.id, NEW_BOARD_TITLE)]
      const next = s.currentId === id ? mostRecentlyOpened(rest).id : s.currentId
      // Gone from the registry before it is gone from the screen, so a reload
      // straight after cannot bring it back. Its contents can still be open
      // here: dropping that database waits for the board to close, it does
      // not fail.
      await backend.boards.remove(s.user.id, id)
      setState({ ...s, boards: rest, currentId: next })
      if (next !== s.currentId) await backend.boards.markOpened(s.user.id, next)
    },
    [backend],
  )

  const account = useMemo<Account | null>(() => {
    if (!state) return null
    const currentBoard = state.boards.find((b) => b.id === state.currentId) ?? state.boards[0]!
    return { user: state.user, boards: state.boards, currentBoard, backend, openBoard, createBoard, renameBoard, deleteBoard }
  }, [state, backend, openBoard, createBoard, renameBoard, deleteBoard])

  if (error) {
    return (
      <div data-testid="account-error" style={{ padding: 24, font: '14px system-ui, sans-serif' }}>
        Couldn&apos;t start a session: {error}
      </div>
    )
  }
  if (!account) return <div data-testid="account-loading">Loading…</div>
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>
}
