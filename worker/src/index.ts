import { createAuth } from './auth'
import { fail } from './http'

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/auth/')) return createAuth(env, request).handler(request)
    return fail(404, 'Not found.')
  },
} satisfies ExportedHandler<Env>
