// Secrets aren't in wrangler.jsonc, so `wrangler types` only sees them when a
// .dev.vars happens to exist. Declared here so CI typechecks without one —
// on both the global `Env` handlers receive and `cloudflare:workers`' env.
interface Env {
  BETTER_AUTH_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}
declare namespace Cloudflare {
  interface Env {
    BETTER_AUTH_SECRET: string
    GOOGLE_CLIENT_ID: string
    GOOGLE_CLIENT_SECRET: string
  }
}
