/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `cloud` for the Cloudflare backend; anything else is the in-browser one. */
  readonly VITE_BACKEND?: string
}
