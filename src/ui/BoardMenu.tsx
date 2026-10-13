import { useEffect, useRef, useState } from 'react'
import type { BoardId, BoardRecord } from '../account/types'

type Props = {
  boards: BoardRecord[]
  currentId: BoardId
  onOpen: (id: BoardId) => void
  /** Creates and opens a board, resolving with it so it can be named in place. */
  onCreate: () => Promise<BoardRecord>
  onRename: (id: BoardId, title: string) => void
  onDelete: (id: BoardId) => void
}

const ink = '#1a1a1a'

const button: React.CSSProperties = {
  font: '500 12px system-ui, sans-serif',
  padding: '6px 10px',
  borderRadius: 6,
  border: `2px solid ${ink}`,
  background: '#fdfcf9',
  color: ink,
  cursor: 'pointer',
}

const iconButton: React.CSSProperties = {
  font: '500 13px system-ui, sans-serif',
  width: 24,
  height: 24,
  padding: 0,
  border: 'none',
  borderRadius: 5,
  background: 'transparent',
  color: '#6b6860',
  cursor: 'pointer',
  flex: 'none',
}

/**
 * The board switcher, top right: the open board's title, and under it every
 * board the user owns — open, rename, delete, or start a new one.
 */
export function BoardMenu({ boards, currentId, onOpen, onCreate, onRename, onDelete }: Props) {
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState<BoardId | null>(null)
  const [confirming, setConfirming] = useState<BoardId | null>(null)
  // A board just made with "+ New board": naming it is the last step of
  // making it, so the menu gets out of the way once that is done.
  const [fresh, setFresh] = useState<BoardId | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const current = boards.find((b) => b.id === currentId)

  const close = () => {
    setOpen(false)
    setRenaming(null)
    setConfirming(null)
    setFresh(null)
  }

  useEffect(() => {
    if (!open) return
    const onPress = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close()
    }
    // Keys pressed inside the menu never get this far (see onKeyDown below);
    // this is Escape with focus elsewhere — on the page, after a rename.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', onPress)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPress)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div
      ref={root}
      // Every key pressed in here is the menu's. The board listens on window,
      // and Backspace in the title field must not reach it as "delete the
      // selected nodes" — nor ⌘Z as an undo of the board.
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' && open && renaming === null) close()
      }}
      style={{ position: 'fixed', right: 16, top: 16, zIndex: 20, font: '500 12px system-ui, sans-serif' }}
    >
      <button
        data-testid="board-menu-toggle"
        data-board-id={currentId}
        aria-expanded={open}
        title="Your boards"
        style={{
          ...button,
          maxWidth: 240,
          // The toolbar's height, so the two read as one row of chrome.
          height: 50,
          padding: '0 14px',
          background: '#f3f1ea',
          borderRadius: 10,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {current?.title ?? 'Board'} ▾
      </button>
      {open && (
        <div
          data-testid="board-menu"
          role="menu"
          aria-label="Boards"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            width: 264,
            maxHeight: 'min(420px, calc(100vh - 96px))',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: 8,
            background: '#fdfcf9',
            border: `2px solid ${ink}`,
            borderRadius: 10,
            boxShadow: '4px 5px 0 rgba(26,26,26,.13)',
          }}
        >
          <div style={{ padding: '4px 6px 6px', color: '#6b6860', font: '600 11px system-ui, sans-serif' }}>
            BOARDS
          </div>
          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {boards.map((b) => {
              const isCurrent = b.id === currentId
              if (confirming === b.id) {
                return (
                  <div
                    key={b.id}
                    data-testid="board-row"
                    data-board-id={b.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, background: '#f6e3df' }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      Delete “{b.title}”?
                    </span>
                    <button
                      data-testid="board-delete-confirm"
                      style={{ ...button, padding: '3px 8px', background: ink, color: '#fff' }}
                      onClick={() => {
                        setConfirming(null)
                        onDelete(b.id)
                      }}
                    >
                      Delete
                    </button>
                    <button data-testid="board-delete-cancel" style={{ ...button, padding: '3px 8px' }} onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </div>
                )
              }
              return (
                <div
                  key={b.id}
                  data-testid="board-row"
                  data-board-id={b.id}
                  aria-current={isCurrent}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    borderRadius: 6,
                    background: isCurrent ? '#f3f1ea' : 'transparent',
                    boxShadow: isCurrent ? `inset 3px 0 0 ${ink}` : 'none',
                  }}
                >
                  {renaming === b.id ? (
                    <RenameInput
                      initial={b.title}
                      onDone={(title) => {
                        setRenaming(null)
                        if (title !== null && title.trim() && title.trim() !== b.title) onRename(b.id, title)
                        if (title !== null && fresh === b.id) close()
                      }}
                    />
                  ) : (
                    <button
                      data-testid="board-open"
                      role="menuitem"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: 'left',
                        padding: '7px 8px',
                        border: 'none',
                        background: 'transparent',
                        color: ink,
                        font: `${isCurrent ? 700 : 500} 13px system-ui, sans-serif`,
                        cursor: 'pointer',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      onClick={() => {
                        close()
                        if (!isCurrent) onOpen(b.id)
                      }}
                      onDoubleClick={() => setRenaming(b.id)}
                    >
                      {b.title}
                    </button>
                  )}
                  {renaming !== b.id && (
                    <>
                      <button data-testid="board-rename" aria-label={`Rename ${b.title}`} title="Rename" style={iconButton} onClick={() => setRenaming(b.id)}>
                        ✎
                      </button>
                      <button data-testid="board-delete" aria-label={`Delete ${b.title}`} title="Delete" style={iconButton} onClick={() => setConfirming(b.id)}>
                        ×
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
          <button
            data-testid="board-new"
            style={{ ...button, marginTop: 6 }}
            onClick={async () => {
              setConfirming(null)
              const b = await onCreate()
              setFresh(b.id)
              setRenaming(b.id)
            }}
          >
            + New board
          </button>
          <div style={{ marginTop: 8, padding: '8px 6px 2px', borderTop: '1px solid #e4e1d8', color: '#6b6860', font: '12px system-ui, sans-serif' }}>
            <strong style={{ color: ink }}>Guest</strong> · boards are saved in this browser
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * A title being edited. Reports once: the new text on Enter or blur, null on
 * Escape — and never twice, since committing unmounts it and some browsers
 * deliver a blur on the way out.
 */
function RenameInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (title: string | null) => {
    if (done.current) return
    done.current = true
    onDone(title)
  }
  return (
    <input
      data-testid="board-rename-input"
      aria-label="Board title"
      autoFocus
      value={value}
      maxLength={120}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value)
        else if (e.key === 'Escape') finish(null)
      }}
      onBlur={() => finish(value)}
      style={{
        flex: 1,
        minWidth: 0,
        margin: 2,
        padding: '5px 6px',
        border: `2px solid ${ink}`,
        borderRadius: 5,
        font: '600 13px system-ui, sans-serif',
        color: ink,
        background: '#fff',
      }}
    />
  )
}
