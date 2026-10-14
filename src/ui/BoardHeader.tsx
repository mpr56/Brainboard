import { useState } from 'react'
import { TitleInput } from './TitleInput'

type Props = {
  title: string
  onHome: () => void
  onRename: (title: string) => void
  /** Open with the title already being edited — for a board that was just made. */
  autoRename?: boolean
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

/**
 * Top right of a board: the way home, and the board's name, which is renamed
 * by clicking it. Boards are made and deleted on the home screen.
 */
export function BoardHeader({ title, onHome, onRename, autoRename = false }: Props) {
  const [renaming, setRenaming] = useState(autoRename)
  return (
    <div
      data-testid="board-header"
      // Every key pressed in here is the header's. The board listens on
      // window, and Backspace in the title field must not reach it as "delete
      // the selected nodes" — nor ⌘Z as an undo of the board.
      onKeyDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        right: 16,
        top: 16,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: 8,
        // The toolbar's height, so the two read as one row of chrome.
        height: 50,
        boxSizing: 'border-box',
        maxWidth: 'calc(100vw - 32px)',
        background: '#f3f1ea',
        border: `2px solid ${ink}`,
        borderRadius: 10,
      }}
    >
      <button data-testid="board-home" title="All boards" style={button} onClick={onHome}>
        ← Boards
      </button>
      {renaming ? (
        <TitleInput
          testId="board-title-input"
          initial={title}
          style={{ width: 200, font: '600 13px system-ui, sans-serif' }}
          onDone={(next) => {
            setRenaming(false)
            if (next !== null && next.trim() && next.trim() !== title) onRename(next)
          }}
        />
      ) : (
        <button
          data-testid="board-title"
          title="Rename board"
          onClick={() => setRenaming(true)}
          style={{
            ...button,
            border: '2px solid transparent',
            background: 'transparent',
            font: '600 13px system-ui, sans-serif',
            maxWidth: 240,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title} <span style={{ color: '#8a8578', fontWeight: 500 }}>✎</span>
        </button>
      )}
    </div>
  )
}
