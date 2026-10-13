import { App } from './App'
import { useAccount } from './account/AccountProvider'
import { BoardMenu } from './ui/BoardMenu'

/** The open board, and the switcher that changes which one that is. */
export function Root() {
  const { boards, currentBoard, backend, openBoard, createBoard, renameBoard, deleteBoard } = useAccount()
  const report = (err: unknown) => console.error('[boards]', err)
  return (
    <>
      <App
        key={currentBoard.id}
        boardId={currentBoard.id}
        boardTitle={currentBoard.title}
        persist={backend.persistBoard}
      />
      <BoardMenu
        boards={boards}
        currentId={currentBoard.id}
        onOpen={(id) => void openBoard(id).catch(report)}
        onCreate={() => createBoard()}
        onRename={(id, title) => void renameBoard(id, title).catch(report)}
        onDelete={(id) => void deleteBoard(id).catch(report)}
      />
    </>
  )
}
