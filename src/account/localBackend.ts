import { indexedDbAssets } from '../document/assets'
import { persistDoc } from '../document/persistence'
import { createLocalAuth } from './localAuth'
import { createLocalBoards } from './localBoards'
import { localDb } from './localDb'
import type { Backend } from './types'

/** Everything in this browser: a cookie for the session, IndexedDB for the rest. */
export function createLocalBackend(): Backend {
  const open = localDb()
  return {
    auth: createLocalAuth(open),
    boards: createLocalBoards(open),
    persistBoard: persistDoc,
    assets: indexedDbAssets,
  }
}
