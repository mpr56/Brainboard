import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Persistence, SyncStatus } from './document/persistence'
import { useBoard } from './useBoard'

function persistWithStatus(initial: SyncStatus) {
  let status = initial
  const listeners = new Set<(s: SyncStatus) => void>()
  const persist = (): Persistence => ({
    whenSynced: Promise.resolve(),
    destroy: async () => {},
    status: {
      get: () => status,
      subscribe(cb) {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
    },
  })
  const set = (s: SyncStatus) => {
    status = s
    for (const l of listeners) l(s)
  }
  return { persist, set, listeners }
}

describe('useBoard status', () => {
  it('is null for persistence with no server', async () => {
    const persist = (): Persistence => ({ whenSynced: Promise.resolve(), destroy: async () => {} })
    const { result } = renderHook(() => useBoard('plain', persist))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.status).toBeNull()
  })

  it('follows the persistence’s connection status, and stops listening on unmount', async () => {
    const p = persistWithStatus('connecting')
    const { result, unmount } = renderHook(() => useBoard('synced', p.persist))
    await waitFor(() => expect(result.current.status).toBe('connecting'))
    act(() => p.set('offline'))
    expect(result.current.status).toBe('offline')
    unmount()
    expect(p.listeners.size).toBe(0)
  })
})
