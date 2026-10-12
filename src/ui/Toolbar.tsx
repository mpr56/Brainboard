import type { EdgeStyleKind } from '../types'

type Props = {
  onAddText: () => void
  onUndo: () => void
  onRedo: () => void
  zoom: number
  onZoom: (factor: number) => void
  edgeStyle: EdgeStyleKind
  onEdgeStyle: (kind: EdgeStyleKind) => void
  /** Frame everything on the board, centred. */
  onFit?: () => void
  onExport?: () => void
}

/** Cycle order for the connector-style control. */
export const EDGE_STYLE_KINDS: EdgeStyleKind[] = ['curve', 'arrow', 'elbow', 'straight']

export const nextEdgeStyle = (kind: EdgeStyleKind): EdgeStyleKind =>
  EDGE_STYLE_KINDS[(EDGE_STYLE_KINDS.indexOf(kind) + 1) % EDGE_STYLE_KINDS.length] ?? 'curve'

const LABEL: Record<EdgeStyleKind, string> = {
  curve: 'Curve',
  arrow: 'Arrow',
  elbow: 'Elbow',
  straight: 'Straight',
}

const button = (active: boolean): React.CSSProperties => ({
  font: '500 12px system-ui, sans-serif',
  padding: '6px 10px',
  borderRadius: 6,
  border: '2px solid #1a1a1a',
  background: active ? '#1a1a1a' : '#fdfcf9',
  color: active ? '#fff' : '#1a1a1a',
  cursor: 'pointer',
})

export function Toolbar({
  onAddText,
  onUndo,
  onRedo,
  zoom,
  onZoom,
  edgeStyle,
  onEdgeStyle,
  onFit,
  onExport,
}: Props) {
  return (
    <div
      data-testid="toolbar"
      style={{
        position: 'absolute',
        left: 16,
        top: 16,
        zIndex: 10,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        padding: 8,
        background: '#f3f1ea',
        border: '2px solid #1a1a1a',
        borderRadius: 10,
      }}
    >
      {/* There is no connect mode to switch into: a link is drawn by dragging
          a node's hover handle, so the toolbar has no tool buttons at all.
          Tool choice is made per gesture, from whatever the pointer landed on. */}
      {/* DoD 3: all three routing styles must be reachable, not just the
          default. One cycle button keeps the toolbar's shape. */}
      <button
        data-testid="edge-style"
        data-edge-style={edgeStyle}
        title="Connector style"
        style={button(false)}
        onClick={() => onEdgeStyle(nextEdgeStyle(edgeStyle))}
      >
        {LABEL[edgeStyle]}
      </button>
      <button data-testid="add-text" style={button(false)} onClick={onAddText}>
        + Text
      </button>
      <button data-testid="undo" style={button(false)} onClick={onUndo}>
        Undo
      </button>
      <button data-testid="redo" style={button(false)} onClick={onRedo}>
        Redo
      </button>
      <button data-testid="zoom-out" style={button(false)} onClick={() => onZoom(1 / 1.2)}>
        −
      </button>
      <span data-testid="zoom-level" style={{ font: '500 11px monospace', minWidth: 42, textAlign: 'center' }}>
        {Math.round(zoom * 100)}%
      </span>
      <button data-testid="zoom-in" style={button(false)} onClick={() => onZoom(1.2)}>
        +
      </button>
      {onFit && (
        <button data-testid="fit-view" title="Fit everything on screen (⇧1)" style={button(false)} onClick={onFit}>
          Fit
        </button>
      )}
      {onExport && (
        <button data-testid="export" title="Export as an image or PDF" style={button(false)} onClick={onExport}>
          Export
        </button>
      )}
    </div>
  )
}
