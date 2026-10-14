// Secrets aren't in wrangler.jsonc, so `wrangler types` only sees them when a
// .dev.vars happens to exist. Declared here so CI typechecks without one.
declare namespace Cloudflare {
  interface Env {
    BETTER_AUTH_SECRET: string
    GOOGLE_CLIENT_ID: string
    GOOGLE_CLIENT_SECRET: string
  }
}
