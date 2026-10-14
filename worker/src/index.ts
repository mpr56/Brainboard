import { routeAssets } from './assets'
import { createAuth, sessionUserId } from './auth'
import { routeBoards } from './boards'
import { fail } from './http'
import { routePreviews } from './previews'

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/auth/')) return createAuth(env, request).handler(request)
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
