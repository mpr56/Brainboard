import { useEffect, useState } from 'react'
import type { BoardId } from './account/types'

/**
 * Where the user is, kept in the URL hash: `#/` is home, `#/b/<id>` a board.
 * A hash, not a path, so the static build needs no server-side rewrites.
 */
export type Route = { page: 'home' } | { page: 'board'; boardId: BoardId }

const BOARD = /^#\/b\/([\w-]+)$/

export function parseRoute(hash: string): Route {
  const m = BOARD.exec(hash)
  return m ? { page: 'board', boardId: m[1]! } : { page: 'home' }
}

export const routeHash = (r: Route) => (r.page === 'board' ? `#/b/${r.boardId}` : '#/')

/** Goes to `r` as a new history entry, or in place of the current one with `replace`. */
export function navigate(r: Route, { replace = false } = {}): void {
  const hash = routeHash(r)
  if (location.hash === hash) return
  if (replace) {
    history.replaceState(history.state, '', hash)
    // replaceState fires no hashchange of its own.
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    location.hash = hash
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
