import { SELF } from 'cloudflare:test'

export const ORIGIN = 'http://example.com'

/** A request to the Worker as the browser would send it: same origin, with the session cookie. */
export function call(path: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Origin', ORIGIN)
  if (cookie) headers.set('Cookie', cookie)
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers })
}

/** A fresh anonymous user and the cookie that signs in as them. */
export async function signIn(): Promise<{ cookie: string; userId: string }> {
  const res = await call('/api/auth/sign-in/anonymous', { method: 'POST' })
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`)
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const body = await res.json<{ user: { id: string } }>()
  return { cookie, userId: body.user.id }
}
