import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardId, BoardPreview, BoardRecord } from '../account/types'
import { droppedFiles } from '../media/dropped'
import { MEDIA_ACCEPT } from '../media/ingest'
import { routeHash } from '../route'
import { formatBytes, timeAgo } from './format'
import { TitleInput } from './TitleInput'

type Props = {
  boards: BoardRecord[]
  loadPreview: (id: BoardId) => Promise<BoardPreview | null>
  /** Bumped per board when its preview is re-saved, so a stale one is fetched again. */
  previewRevs?: Record<BoardId, number>
  onCreate: () => void
  /** Starts a board from dropped or chosen files; `folder` names it when one folder was dropped. */
  onStartFromFiles: (files: File[], folder: string | null) => void
  onRename: (id: BoardId, title: string) => void
  onDelete: (id: BoardId) => void
  /** Makes a board from an exported board file; rejects with a message to show if it can't. */
  onImportFile?: (file: File) => Promise<void>
  estimateStorage?: () => Promise<{ usage: number; quota: number } | null>
  /** Shown at the foot of the sidebar: sign-in, or who is signed in. */
  accountSlot?: React.ReactNode
}

const ink = '#1a1a1a'
const muted = '#8a8578'
const paper = '#fdfcf9'
const panel = '#f3f1ea'
const shadow = '4px 5px 0 rgba(26,26,26,.13)'
const font = (weight: number, size: number) => `${weight} ${size}px system-ui, sans-serif`

/** What the sidebar will hold; only "My boards" exists yet. */
const SOON = ['Shared with me', 'Templates', 'Media library', 'Archive']

const defaultEstimate = async () => {
  const e = await navigator.storage?.estimate?.()
  return e && e.usage !== undefined && e.quota ? { usage: e.usage, quota: e.quota } : null
}

type Shown = { key: number; url: string | null; nodes: number; media: number }

/**
 * Every board the user owns, most recently opened first, as cards with a
 * picture of each — plus search, a new-board button, and a tile that turns
 * dropped files into a board.
 */
export function Home({
  boards,
  loadPreview,
  previewRevs = {},
  onCreate,
  onStartFromFiles,
  onRename,
  onDelete,
  onImportFile,
  estimateStorage = defaultEstimate,
  accountSlot,
}: Props) {
  const [query, setQuery] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const importFile = async (file: File) => {
    if (!onImportFile) return
    setImporting(true)
    setImportError(null)
    try {
      await onImportFile(file)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }
  const [previews, setPreviews] = useState<Map<BoardId, Shown>>(new Map())
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)

  const sorted = useMemo(() => [...boards].sort((a, b) => b.openedAt - a.openedAt), [boards])
  const q = query.trim().toLowerCase()
  const shown = q ? sorted.filter((b) => b.title.toLowerCase().includes(q)) : sorted

  // Fetch each board's preview once per revision, revoking the picture it replaces.
  const latest = useRef(previews)
  latest.current = previews
  useEffect(() => {
    let alive = true
    for (const b of boards) {
      const key = previewRevs[b.id] ?? 0
      if (latest.current.get(b.id)?.key === key) continue
      void loadPreview(b.id).then(
        (p) => {
          if (!alive) return
          setPreviews((prev) => {
            const old = prev.get(b.id)
            if (old?.url) URL.revokeObjectURL(old.url)
            const next = new Map(prev)
            next.set(b.id, {
              key,
              url: p?.image ? URL.createObjectURL(p.image) : null,
              nodes: p?.nodes ?? 0,
              media: p?.media ?? 0,
            })
            return next
          })
        },
        () => {},
      )
    }
    return () => {
      alive = false
    }
  }, [boards, previewRevs, loadPreview])
  useEffect(
    () => () => {
      for (const p of latest.current.values()) if (p.url) URL.revokeObjectURL(p.url)
    },
    [],
  )

  useEffect(() => {
    let alive = true
    estimateStorage().then((e) => alive && setStorage(e), () => {})
    return () => {
      alive = false
    }
  }, [estimateStorage])

  return (
    <div data-testid="home" style={{ position: 'fixed', inset: 0, display: 'flex', background: paper, color: ink }}>
      <nav
        aria-label="Library"
        style={{
          width: 220,
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '20px 14px 16px',
          background: panel,
          borderRight: `2px solid ${ink}`,
        }}
      >
        <div style={{ font: font(800, 20), letterSpacing: '-0.02em', padding: '0 8px 16px' }}>brainboard.</div>
        <div
          aria-current="page"
          style={{ padding: '8px 10px', border: `2px solid ${ink}`, borderRadius: 8, background: paper, font: font(600, 13) }}
        >
          My boards
        </div>
        {SOON.map((label) => (
          <div
            key={label}
            aria-disabled="true"
            title="Coming soon"
            style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', color: '#a9a598', font: font(500, 13), cursor: 'default' }}
          >
            <span style={{ flex: 1 }}>{label}</span>
            <span style={{ font: font(600, 10), letterSpacing: '0.04em', textTransform: 'uppercase', color: '#b9b5ab' }}>soon</span>
          </div>
        ))}
        {/* {storage && (
          <div
            data-testid="storage"
            style={{ marginTop: 'auto', padding: 10, border: '2px dashed #b9b5ab', borderRadius: 8, font: font(500, 12), color: muted }}
          >
            {formatBytes(storage.usage)} of {formatBytes(storage.quota)}
            <div style={{ height: 8, marginTop: 7, border: `2px solid ${ink}`, borderRadius: 5, background: '#fff', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(100, Math.max(1, (storage.usage / storage.quota) * 100))}%`, background: ink }} />
            </div>
          </div>
        )} */}
        {accountSlot && <div style={{ marginTop: 'auto' }}>{accountSlot}</div>}
      </nav>

      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '20px 24px 32px' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
          <input
            data-testid="home-search"
            type="search"
            placeholder="Search boards"
            aria-label="Search boards"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            style={{
              flex: 1,
              minWidth: 0,
              height: 40,
              padding: '0 14px',
              border: `2px solid ${ink}`,
              borderRadius: 10,
              background: '#fff',
              font: font(500, 14),
              color: ink,
            }}
          />
          <button
            data-testid="home-new"
            onClick={onCreate}
            style={{
              height: 40,
              padding: '0 16px',
              border: `2px solid ${ink}`,
              borderRadius: 10,
              background: ink,
              color: '#fff',
              font: font(600, 13),
              cursor: 'pointer',
              boxShadow: shadow,
            }}
          >
            + New board
          </button>
          {onImportFile && (
            <>
              <button
                data-testid="home-import"
                disabled={importing}
                title="Import a board file exported from a board"
                onClick={() => importInput.current?.click()}
                style={{
                  height: 40,
                  padding: '0 16px',
                  border: `2px solid ${ink}`,
                  borderRadius: 10,
                  background: paper,
                  color: ink,
                  font: font(600, 13),
                  cursor: importing ? 'wait' : 'pointer',
                }}
              >
                {importing ? 'Importing…' : 'Import'}
              </button>
              <input
                ref={importInput}
                data-testid="home-import-input"
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0]
                  e.currentTarget.value = ''
                  if (file) void importFile(file)
                }}
              />
            </>
          )}
        </div>
        {importError && (
          <p role="alert" data-testid="home-import-error" style={{ margin: '0 0 16px', font: font(500, 14), color: '#c0392b' }}>
            Couldn&apos;t import that file: {importError}
          </p>
        )}

        {boards.length === 0 && (
          <p style={{ margin: '0 0 16px', font: font(500, 14), color: muted }}>No boards yet — start one, or drop some files below.</p>
        )}
        {q && shown.length === 0 && (
          <p data-testid="home-no-results" style={{ margin: '0 0 16px', font: font(500, 14), color: muted }}>
            No boards match “{query.trim()}”.
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 18 }}>
          {shown.map((b) => (
            <BoardCard key={b.id} board={b} preview={previews.get(b.id)} onRename={onRename} onDelete={onDelete} />
          ))}
          {!q && <DropTile onFiles={onStartFromFiles} />}
        </div>
      </main>
    </div>
  )
}

function BoardCard({
  board,
  preview,
  onRename,
  onDelete,
}: {
  board: BoardRecord
  preview: Shown | undefined
  onRename: (id: BoardId, title: string) => void
  onDelete: (id: BoardId) => void
}) {
  const [hover, setHover] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const icon: React.CSSProperties = {
    width: 26,
    height: 26,
    padding: 0,
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    color: hover ? ink : '#b9b5ab',
    font: font(500, 14),
    cursor: 'pointer',
    flex: 'none',
  }
  return (
    <div
      data-testid="board-card"
      data-board-id={board.id}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: `2px solid ${ink}`,
        borderRadius: 10,
        overflow: 'hidden',
        background: '#fff',
        boxShadow: hover ? shadow : 'none',
        translate: hover ? '-1px -2px' : '0 0',
        transition: 'box-shadow 120ms, translate 120ms',
      }}
    >
      <a
        href={routeHash({ page: 'board', boardId: board.id })}
        data-testid="board-card-open"
        aria-label={`Open ${board.title}`}
        style={{ display: 'block', aspectRatio: '2 / 1', borderBottom: `2px solid ${ink}`, background: '#eae7df' }}
      >
        {preview?.url ? (
          <img
            data-testid="board-thumb"
            src={preview.url}
            alt=""
            style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{ width: '100%', height: '100%', background: 'repeating-linear-gradient(135deg,#e8e5dd 0 8px,#dedad0 8px 16px)' }}
          />
        )}
      </a>
      {confirming ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', background: '#f6e3df', minHeight: 58, boxSizing: 'border-box' }}>
          <span style={{ flex: 1, font: font(600, 13) }}>Delete this board?</span>
          <button
            data-testid="board-delete-confirm"
            onClick={() => {
              setConfirming(false)
              onDelete(board.id)
            }}
            style={{ padding: '4px 9px', border: `2px solid ${ink}`, borderRadius: 6, background: ink, color: '#fff', font: font(600, 12), cursor: 'pointer' }}
          >
            Delete
          </button>
          <button
            data-testid="board-delete-cancel"
            onClick={() => setConfirming(false)}
            style={{ padding: '4px 9px', border: `2px solid ${ink}`, borderRadius: 6, background: paper, color: ink, font: font(600, 12), cursor: 'pointer' }}
          >
            Keep
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '9px 8px 10px 12px', minHeight: 58, boxSizing: 'border-box' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {renaming ? (
              <TitleInput
                testId="board-rename-input"
                initial={board.title}
                style={{ width: '100%', boxSizing: 'border-box' }}
                onDone={(title) => {
                  setRenaming(false)
                  if (title !== null && title.trim() && title.trim() !== board.title) onRename(board.id, title)
                }}
              />
            ) : (
              <a
                href={routeHash({ page: 'board', boardId: board.id })}
                data-testid="board-card-title"
                style={{
                  display: 'block',
                  color: ink,
                  textDecoration: 'none',
                  font: font(650, 14),
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {board.title}
              </a>
            )}
            <div data-testid="board-card-meta" style={{ marginTop: 3, font: '500 11px monospace', color: muted, whiteSpace: 'nowrap' }}>
              {!preview ? '' : preview.nodes + preview.media === 0 ? 'empty · ' : `${preview.media} ▶ · ${preview.nodes} ▭ · `}
              {timeAgo(board.openedAt)}
            </div>
          </div>
          {!renaming && (
            <>
              <button data-testid="board-rename" aria-label={`Rename ${board.title}`} title="Rename" style={icon} onClick={() => setRenaming(true)}>
                ✎
              </button>
              <button data-testid="board-delete" aria-label={`Delete ${board.title}`} title="Delete" style={icon} onClick={() => setConfirming(true)}>
                ×
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Drop files or a folder here — or click to choose files — and they become a new board. */
function DropTile({ onFiles }: { onFiles: (files: File[], folder: string | null) => void }) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return (
    <button
      data-testid="home-drop"
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        // Read synchronously, inside the event — see droppedFiles.
        void droppedFiles(e.dataTransfer).then(({ files, folder }) => {
          if (files.length > 0) onFiles(files, folder)
        })
      }}
      style={{
        minHeight: 160,
        border: `2px dashed ${over ? ink : '#b9b5ab'}`,
        borderRadius: 10,
        background: over ? panel : 'transparent',
        color: over ? ink : '#9a968b',
        font: font(500, 13),
        lineHeight: 1.45,
        cursor: 'pointer',
      }}
    >
      drop files or a folder
      <br />
      to start a board
      <input
        ref={input}
        data-testid="home-drop-input"
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])]
          e.currentTarget.value = ''
          if (files.length > 0) onFiles(files, null)
        }}
      />
    </button>
  )
}
