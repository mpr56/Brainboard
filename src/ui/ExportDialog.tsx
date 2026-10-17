import { useState, type ReactNode } from 'react'
import {
  supportsTransparency,
  type ExportBackground,
  type ExportFormat,
  type ExportOptions,
  type ExportPattern,
} from '../export/layout'

type Props = {
  initial: ExportOptions
  /** How many nodes are selected; the "Selection" scope is offered only when some are. */
  selectionSize: number
  onExport: (options: ExportOptions) => Promise<void>
  /** Downloads the whole board as a file that can be imported again. Offered only when given. */
  onExportFile?: () => Promise<void>
  onClose: () => void
}

const FORMATS: [ExportFormat, string][] = [
  ['png', 'PNG'],
  ['jpeg', 'JPEG'],
  ['pdf', 'PDF'],
]
const BACKGROUNDS: [ExportBackground, string][] = [
  ['board', 'Board'],
  ['white', 'White'],
  ['transparent', 'Transparent'],
]
const PATTERNS: [ExportPattern, string][] = [
  ['none', 'Plain'],
  ['dots', 'Dots'],
  ['grid', 'Grid'],
  ['lined', 'Lined'],
]
const SCALES: [number, string][] = [
  [1, '1×'],
  [2, '2×'],
  [3, '3×'],
]

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ font: '600 11px system-ui, sans-serif', color: '#6b675e', textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {label}
      </span>
      <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {children}
      </div>
    </div>
  )
}

function Choice<T extends string | number>(props: {
  group: string
  value: T
  current: T
  disabled?: boolean
  title?: string
  onPick: (v: T) => void
  children: ReactNode
}) {
  const on = props.value === props.current
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      data-testid={`export-${props.group}-${props.value}`}
      disabled={props.disabled}
      title={props.title}
      onClick={() => props.onPick(props.value)}
      style={{
        font: '500 12px system-ui, sans-serif',
        padding: '6px 10px',
        borderRadius: 6,
        border: '2px solid #1a1a1a',
        background: on ? '#1a1a1a' : '#fdfcf9',
        color: on ? '#fdfcf9' : '#1a1a1a',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.4 : 1,
      }}
    >
      {props.children}
    </button>
  )
}

/** Export settings: format, background, paper pattern, resolution, and what to include. */
export function ExportDialog({ initial, selectionSize, onExport, onExportFile, onClose }: Props) {
  const [o, setO] = useState<ExportOptions>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]) => setO((prev) => ({ ...prev, [k]: v }))
  const transparentOk = supportsTransparency(o.format)
  const background = o.background === 'transparent' && !transparentOk ? 'white' : o.background

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="export-dialog"
      role="dialog"
      aria-label="Export"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      style={{
        position: 'absolute',
        left: 16,
        top: 72,
        zIndex: 30,
        width: 300,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: 16,
        background: '#fdfcf9',
        border: '2px solid #1a1a1a',
        borderRadius: 10,
        boxShadow: '4px 5px 0 rgba(26,26,26,.13)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <strong style={{ font: '700 14px system-ui, sans-serif', flex: 1 }}>Export</strong>
        <button
          type="button"
          aria-label="Close"
          data-testid="export-close"
          onClick={onClose}
          style={{ border: 'none', background: 'transparent', font: '600 16px system-ui', cursor: 'pointer' }}
        >
          ×
        </button>
      </div>

      <Row label="Format">
        {FORMATS.map(([v, l]) => (
          <Choice key={v} group="format" value={v} current={o.format} onPick={(x) => set('format', x)}>
            {l}
          </Choice>
        ))}
      </Row>

      <Row label="Background">
        {BACKGROUNDS.map(([v, l]) => (
          <Choice
            key={v}
            group="background"
            value={v}
            current={background}
            disabled={v === 'transparent' && !transparentOk}
            title={v === 'transparent' && !transparentOk ? 'Only PNG can have a transparent background' : undefined}
            onPick={(x) => set('background', x)}
          >
            {l}
          </Choice>
        ))}
      </Row>

      <Row label="Paper">
        {PATTERNS.map(([v, l]) => (
          <Choice key={v} group="pattern" value={v} current={o.pattern} onPick={(x) => set('pattern', x)}>
            {l}
          </Choice>
        ))}
      </Row>

      <Row label="Resolution">
        {SCALES.map(([v, l]) => (
          <Choice key={v} group="scale" value={v} current={o.scale} onPick={(x) => set('scale', x)}>
            {l}
          </Choice>
        ))}
      </Row>

      {selectionSize > 0 && (
        <Row label="Include">
          <Choice group="scope" value="board" current={o.scope} onPick={(x) => set('scope', x)}>
            Whole board
          </Choice>
          <Choice group="scope" value="selection" current={o.scope} onPick={(x) => set('scope', x)}>
            Selection ({selectionSize})
          </Choice>
        </Row>
      )}

      {error && (
        <div role="alert" data-testid="export-error" style={{ font: '500 12px system-ui', color: '#c0392b' }}>
          {error}
        </div>
      )}

      <button
        type="button"
        data-testid="export-go"
        disabled={busy}
        onClick={() => void run(() => onExport({ ...o, background }))}
        style={{
          font: '600 13px system-ui, sans-serif',
          padding: '9px 12px',
          borderRadius: 7,
          border: '2px solid #1a1a1a',
          background: '#2d63d6',
          color: '#fff',
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {busy ? 'Exporting…' : `Download ${o.format === 'jpeg' ? 'JPEG' : o.format.toUpperCase()}`}
      </button>

      {onExportFile && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 12, borderTop: '2px dashed #d6d2c7' }}>
          <span style={{ font: '600 11px system-ui, sans-serif', color: '#6b675e', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Board file
          </span>
          <span style={{ font: '500 12px system-ui, sans-serif', color: '#6b675e' }}>
            The whole board and its media, to import from the home screen.
          </span>
          <button
            type="button"
            data-testid="export-board-file"
            disabled={busy}
            onClick={() => void run(onExportFile)}
            style={{
              font: '600 13px system-ui, sans-serif',
              padding: '8px 12px',
              borderRadius: 7,
              border: '2px solid #1a1a1a',
              background: '#fdfcf9',
              color: '#1a1a1a',
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            Download board file (.json)
          </button>
        </div>
      )}
    </div>
  )
}
