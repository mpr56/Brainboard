import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AccountBadge } from './AccountBadge'

describe('AccountBadge', () => {
  it('offers Google sign-in to an anonymous user when the backend supports it', () => {
    const onSignIn = vi.fn()
    render(<AccountBadge user={{ id: 'u', kind: 'anonymous', createdAt: 0 }} onSignIn={onSignIn} />)
    fireEvent.click(screen.getByTestId('sign-in-google'))
    expect(onSignIn).toHaveBeenCalled()
  })

  it('shows nothing for an anonymous user without Google support', () => {
    const { container } = render(<AccountBadge user={{ id: 'u', kind: 'anonymous', createdAt: 0 }} />)
    expect(container.textContent).toBe('')
  })

  it('shows who is signed in', () => {
    render(<AccountBadge user={{ id: 'u', kind: 'google', createdAt: 0, name: 'Ada', email: 'ada@x.io' }} />)
    expect(screen.getByTestId('account-name').textContent).toBe('Ada')
  })
})
