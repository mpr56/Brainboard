import type { Backend } from '../types'
import { createCloudAssets } from './cloudAssets'
import { createCloudAuth } from './cloudAuth'
import { createCloudBoards } from './cloudBoards'
import { createCloudPersistence } from './cloudPersistence'

/** Everything on Cloudflare, with this browser's IndexedDB as a cache in front. */
export function createCloudBackend(): Backend {
  const auth = createCloudAuth()
  const assets = createCloudAssets()
  return {
    auth: {
      ...auth,
      // Retrying uploads needs a session, so it waits for one.
      async start() {
        const session = await auth.start()
        void assets.retryPending()
        return session
      },
    },
    boards: createCloudBoards(),
    // Made once: useBoard depends on its identity.
    persistBoard: createCloudPersistence(),
    assets,
  }
}
