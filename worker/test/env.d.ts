// Only the test pool provides this binding, so it is optional: the Worker's own
// `Env` (which lacks it) must still satisfy `Cloudflare.Env`.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS?: import('cloudflare:test').D1Migration[]
  }
}
