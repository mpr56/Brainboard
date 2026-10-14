import { useCallback, useEffect, useRef, useState } from 'react'
import { App } from './App'
import { useAccount } from './account/AccountProvider'
import type { BoardId, BoardPreview } from './account/types'
import { navigate, useRoute } from './route'
import { BoardHeader } from './ui/BoardHeader'
import { Home } from './ui/Home'

const report = (err: unknown) => console.error('[boards]', err)

/** Home, or the board the URL names. */
export function Root() {
  const { user, boards, backend, markOpened, createBoard, renameBoard, deleteBoard } = useAccount()
  const route = useRoute()
  const board = route.page === 'board' ? boards.find((b) => b.id === route.boardId) : undefined

  // A board made from home opens with its title ready to type.
  const [justMade, setJustMade] = useState<BoardId | null>(null)
  // Files dropped on home, waiting for the board made for them to load.
  const pendingFiles = useRef<{ boardId: BoardId; files: File[] } | null>(null)
  // Bumped when a board's preview is re-saved, so home fetches the new one.
  const [previewRevs, setPreviewRevs] = useState<Record<BoardId, number>>({})

  // A board that is not this user's — deleted, mistyped, someone else's link —
  // is home, not an error page.
  useEffect(() => {
    if (route.page === 'board' && !board) navigate({ page: 'home' }, { replace: true })
  }, [route, board])

  const openId = board?.id
  useEffect(() => {
    if (openId) void markOpened(openId).catch(report)
    // Anything waiting for a board is spent once another one, or home, is open.
    if (pendingFiles.current && pendingFiles.current.boardId !== openId) pendingFiles.current = null
    setJustMade((made) => (made === openId ? made : null))
  }, [openId, markOpened])

  useEffect(() => {
    document.title = board ? `${board.title} · brainstorm` : 'Boards · brainstorm'
  }, [board])

  const startBoard = useCallback(
    async (title?: string, files?: File[]) => {
      const made = await createBoard(title)
      if (files) pendingFiles.current = { boardId: made.id, files }
      else setJustMade(made.id)
      navigate({ page: 'board', boardId: made.id })
    },
    [createBoard],
  )

  const savePreview = useCallback(
    async (preview: Omit<BoardPreview, 'savedAt'>) => {
      if (!openId) return
      await backend.boards.savePreview(user.id, openId, preview)
      setPreviewRevs((r) => ({ ...r, [openId]: (r[openId] ?? 0) + 1 }))
    },
    [backend, user.id, openId],
  )

  const loadPreview = useCallback((id: BoardId) => backend.boards.getPreview(user.id, id), [backend, user.id])

  if (route.page === 'board') {
    if (!board) return null
    return (
      <>
        <App
          key={board.id}
          boardId={board.id}
          boardTitle={board.title}
          persist={backend.persistBoard}
          onPreview={savePreview}
          initialFiles={pendingFiles.current?.boardId === board.id ? pendingFiles.current.files : undefined}
        />
        <BoardHeader
          key={`header-${board.id}`}
          title={board.title}
          autoRename={justMade === board.id}
          onHome={() => navigate({ page: 'home' })}
          onRename={(title) => void renameBoard(board.id, title).catch(report)}
        />
      </>
    )
  }

  return (
    <Home
      boards={boards}
      loadPreview={loadPreview}
      previewRevs={previewRevs}
      onCreate={() => void startBoard().catch(report)}
      onStartFromFiles={(files, folder) => void startBoard(folder ?? undefined, files).catch(report)}
      onRename={(id, title) => void renameBoard(id, title).catch(report)}
      onDelete={(id) => void deleteBoard(id).catch(report)}
    />
  )
}
