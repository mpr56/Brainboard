type Props = { count: number; busy: boolean; onImport: () => void; onDismiss: () => void }

// Home's palette (ui/Home.tsx).
const ink = '#1a1a1a'
const paper = '#fdfcf9'
const shadow = '4px 5px 0 rgba(26,26,26,.13)'
const font = (weight: number, size: number) => `${weight} ${size}px system-ui, sans-serif`

const button = (primary: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  border: `2px solid ${ink}`,
  borderRadius: 8,
  background: primary ? ink : paper,
  color: primary ? paper : ink,
  font: font(600, 13),
  cursor: 'pointer',
})

/** A one-time offer, on home, to copy this browser's boards into the account. */
export function ImportBanner({ count, busy, onImport, onDismiss }: Props) {
  return (
    <div
      data-testid="import-banner"
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        translate: '-50% 0',
        zIndex: 10,
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        padding: '10px 14px',
        border: `2px solid ${ink}`,
        borderRadius: 10,
        background: paper,
        boxShadow: shadow,
        color: ink,
        font: font(500, 14),
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      <span>
        Upload {count} board{count === 1 ? '' : 's'} from this browser to your account?
      </span>
      <button data-testid="import-yes" disabled={busy} onClick={onImport} style={button(true)}>
        {busy ? 'Uploading…' : 'Upload'}
      </button>
      <button data-testid="import-no" disabled={busy} onClick={onDismiss} style={button(false)}>
        Not now
      </button>
    </div>
  )
}
