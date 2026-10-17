import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import type { Persistence, SyncStatus } from './document/persistence'

const persistAs = (status: SyncStatus) => (): Persistence => ({
  whenSynced: Promise.resolve(),
  destroy: async () => {},
  status: { get: () => status, subscribe: () => () => {} },
})

describe('App sync note', () => {
  it('says when the board is offline', async () => {
    render(<App boardId="offline-test" persist={persistAs('offline')} />)
    expect((await screen.findByTestId('sync-offline')).textContent).toContain('Offline')
  })

  it('says nothing while online', async () => {
    render(<App boardId="online-test" persist={persistAs('online')} />)
    await screen.findByTestId('media-input') // the board has rendered
    expect(screen.queryByTestId('sync-offline')).toBeNull()
  })
})
