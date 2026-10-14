import { routePartykitRequest } from 'partyserver'
import { routeAssets } from './assets'
import { createAuth, sessionUserId } from './auth'
import { ownsBoard, routeBoards } from './boards'
import { fail } from './http'
import { routePreviews } from './previews'

export { BoardRoom } from './room'

/**
 * Only the board's owner gets a socket. A deleted board fails here too, so a
 * device still holding a cached copy can't push it back into a wiped room.
 */
async function gateRoom(env: Env, request: Request, boardId: string): Promise<Response | void> {
  const userId = await sessionUserId(env, request)
  if (!userId) return fail(401, 'Not signed in.')
  if (!(await ownsBoard(env, userId, boardId))) return fail(404, 'No such board.')
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/auth/')) return createAuth(env, request).handler(request)
    if (url.pathname.startsWith('/parties/')) {
      const res = await routePartykitRequest(request, env, {
        onBeforeConnect: (req, lobby) => gateRoom(env, req, lobby.name),
        onBeforeRequest: () => fail(400, 'Rooms are WebSocket only.'),
      })
      return res ?? fail(404, 'Not found.')
    }
    if (url.pathname.startsWith('/api/')) {
      const userId = await sessionUserId(env, request)
      if (!userId) return fail(401, 'Not signed in.')
      return (
        (await routeAssets(env, userId, request, url)) ??
        (await routePreviews(env, userId, request, url)) ??
        (await routeBoards(env, userId, request, url)) ??
        fail(404, 'Not found.')
      )
    }
    return fail(404, 'Not found.')
  },
} satisfies ExportedHandler<Env>
