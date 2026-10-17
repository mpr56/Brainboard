import { betterAuth } from 'better-auth'
import { anonymous } from 'better-auth/plugins'
import { moveOwnership } from './ownership'

/** As long as the local backend's cookie: anonymous boards are only as durable as the session. */
const SESSION_SECONDS = 400 * 24 * 60 * 60

/**
 * Built per request: the D1 binding belongs to the request's `env`, and the
 * base URL is whatever origin the request came in on (localhost in dev, the
 * workers.dev host in production) so cookies and OAuth callbacks line up.
 */
export function createAuth(env: Env, request: Request) {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {}
  return betterAuth({
    baseURL: new URL(request.url).origin,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    session: { expiresIn: SESSION_SECONDS, updateAge: 24 * 60 * 60 },
    socialProviders: google,
    plugins: [
      anonymous({
        onLinkAccount: ({ anonymousUser, newUser }) => moveOwnership(env.DB, anonymousUser.user.id, newUser.user.id),
      }),
    ],
  })
}

export async function sessionUserId(env: Env, request: Request): Promise<string | null> {
  const session = await createAuth(env, request).api.getSession({ headers: request.headers })
  return session?.user.id ?? null
}
