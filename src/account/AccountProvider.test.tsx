import { StrictMode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { indexedDbAssets } from '../document/assets'
import { persistDoc } from '../document/persistence'
import { AccountProvider, useAccount, type Account } from './AccountProvider'
import { clearCookie } from './cookie'
import { SESSION_COOKIE, createLocalAuth } from './localAuth'
import { LEGACY_BOARD_ID, createLocalBoards } from './localBoards'
import { localDb } from './localDb'
import type { Backend } from './types'

afterEach(() => clearCookie(SESSION_COOKIE))

function backend(): Backend {
  const open = localDb(`accounts-${Math.random().toString(36).slice(2)}`)
  let t = 0
  return {
    auth: createLocalAuth(open),
    boards: createLocalBoards(open, { now: () => ++t, clearContents: vi.fn().mockResolvedValue(undefined) }),
    persistBoard: persistDoc,
    assets: indexedDbAssets,
  }
}

/** Renders the provider and hands back the live account, re-read after each change. */
async function mount(b = backend()) {
  const seen: { current: Account | null } = { current: null }
  function Probe() {
    const account = useAccount()
    seen.current = account
    return <div data-testid="current">{account.currentBoard.title}</div>
  }
  const view = render(
    <AccountProvider backend={b}>
      <Probe />
    </AccountProvider>,
  )
  await screen.findByTestId('current')
  return { account: () => seen.current!, view, backend: b }
}

describe('AccountProvider', () => {
  it('opens the first user’s adopted board', async () => {
    const { account } = await mount()
    expect(account().user.kind).toBe('anonymous')
    expect(account().boards.map((b) => b.id)).toEqual([LEGACY_BOARD_ID])
    expect(account().currentBoard.id).toBe(LEGACY_BOARD_ID)
  })

  it('switches to a board it creates', async () => {
    const { account } = await mount()
    await act(() => account().createBoard())
    expect(account().boards).toHaveLength(2)
    expect(account().currentBoard.id).toBe(account().boards[1]!.id)
  })

  it('reopens the most recently opened board on the next load', async () => {
    const b = backend()
    const first = await mount(b)
    const made = await act(() => first.account().createBoard())
    await act(() => first.account().openBoard(LEGACY_BOARD_ID))
    await act(() => first.account().openBoard(made.id))
    first.view.unmount()

    const second = await mount(b)
    expect(second.account().currentBoard.id).toBe(made.id)
  })

  it('renames a board', async () => {
    const { account } = await mount()
    await act(() => account().renameBoard(LEGACY_BOARD_ID, 'Ideas'))
    expect(screen.getByTestId('current').textContent).toBe('Ideas')
  })

  it('moves off a board that is deleted while open', async () => {
    const { account } = await mount()
    await act(() => account().createBoard())
    const open = account().currentBoard.id
    await act(() => account().deleteBoard(open))
    expect(account().boards.map((b) => b.id)).toEqual([LEGACY_BOARD_ID])
    expect(account().currentBoard.id).toBe(LEGACY_BOARD_ID)
  })

  it('never leaves a user with no board', async () => {
    const { account } = await mount()
    await act(() => account().deleteBoard(LEGACY_BOARD_ID))
    expect(account().boards).toHaveLength(1)
    expect(account().currentBoard.id).not.toBe(LEGACY_BOARD_ID)
  })

  it('starts one session under StrictMode’s double effect run', async () => {
    const b = backend()
    const start = vi.spyOn(b.auth, 'start')
    render(
      <StrictMode>
        <AccountProvider backend={b}>
          <div data-testid="ready" />
        </AccountProvider>
      </StrictMode>,
    )
    await screen.findByTestId('ready')
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('reports a session that cannot start', async () => {
    const b = backend()
    b.auth = { start: () => Promise.reject(new Error('no storage')) }
    render(
      <AccountProvider backend={b}>
        <div />
      </AccountProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('account-error').textContent).toContain('no storage'))
  })
})
