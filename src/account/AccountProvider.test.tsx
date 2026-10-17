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
    return <div data-testid="titles">{account.boards.map((b) => b.title).join(',')}</div>
  }
  const view = render(
    <AccountProvider backend={b}>
      <Probe />
    </AccountProvider>,
  )
  await screen.findByTestId('titles')
  return { account: () => seen.current!, view, backend: b }
}

describe('AccountProvider', () => {
  it('loads the first user’s adopted board', async () => {
    const { account } = await mount()
    expect(account().user.kind).toBe('anonymous')
    expect(account().boards.map((b) => b.id)).toEqual([LEGACY_BOARD_ID])
  })

  it('picks up boards added behind its back when asked to reload', async () => {
    const { account, backend: b } = await mount()
    const made = await b.boards.create(account().user.id, 'Imported')
    expect(account().boards.map((x) => x.id)).not.toContain(made.id)
    await act(() => account().reloadBoards())
    expect(account().boards.map((x) => x.id)).toContain(made.id)
  })

  it('adds a board it creates', async () => {
    const { account } = await mount()
    const made = await act(() => account().createBoard())
    expect(account().boards.map((b) => b.id)).toEqual([LEGACY_BOARD_ID, made.id])
  })

  it('remembers when a board was opened', async () => {
    const b = backend()
    const first = await mount(b)
    const made = await act(() => first.account().createBoard())
    const before = first.account().boards.find((x) => x.id === LEGACY_BOARD_ID)!.openedAt
    await act(() => first.account().markOpened(LEGACY_BOARD_ID))
    first.view.unmount()

    const second = await mount(b)
    const reloaded = second.account().boards
    expect(reloaded.find((x) => x.id === LEGACY_BOARD_ID)!.openedAt).toBeGreaterThan(before)
    expect(reloaded.find((x) => x.id === LEGACY_BOARD_ID)!.openedAt).toBeGreaterThan(
      reloaded.find((x) => x.id === made.id)!.openedAt,
    )
  })

  it('renames a board', async () => {
    const { account } = await mount()
    await act(() => account().renameBoard(LEGACY_BOARD_ID, 'Ideas'))
    expect(screen.getByTestId('titles').textContent).toBe('Ideas')
  })

  it('can delete every board', async () => {
    const { account } = await mount()
    await act(() => account().deleteBoard(LEGACY_BOARD_ID))
    expect(account().boards).toEqual([])
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
