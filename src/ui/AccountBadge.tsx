import type { User } from '../account/types'

type Props = { user: User; onSignIn?: () => void }

// Home's palette (ui/Home.tsx).
const ink = '#1a1a1a'
const muted = '#8a8578'
const paper = '#fdfcf9'
const font = (weight: number, size: number) => `${weight} ${size}px system-ui, sans-serif`

/**
 * Foot of home's sidebar: "Sign in with Google" while anonymous, who is signed
 * in after. Nothing for an anonymous user on a backend with no sign-in.
 */
export function AccountBadge({ user, onSignIn }: Props) {
  if (user.kind === 'anonymous') {
    if (!onSignIn) return null
    return (
      <button
        data-testid="sign-in-google"
        onClick={onSignIn}
        title="Keep your boards and open them on any device"
        style={{
          width: '100%',
          padding: '8px 10px',
          border: `2px solid ${ink}`,
          borderRadius: 8,
          background: paper,
          color: ink,
          font: font(600, 13),
          cursor: 'pointer',
        }}
      >
        Sign in with Google
      </button>
    )
  }
  return (
    <div style={{ padding: '8px 10px', font: font(500, 12), color: muted }}>
      Signed in as
      <div data-testid="account-name" style={{ font: font(600, 13), color: ink, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {user.name || user.email}
      </div>
    </div>
  )
}
