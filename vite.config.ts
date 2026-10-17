import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig(({ mode }) => {
  // Only the cloud build runs the Worker; plain dev, tests and e2e never load Cloudflare tooling.
  const cloud = loadEnv(mode, process.cwd(), '').VITE_BACKEND === 'cloud'
  return {
    plugins: [react(), ...(cloud ? [cloudflare({ configPath: './worker/wrangler.jsonc' })] : [])],
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.ts'],
      exclude: ['**/node_modules/**', 'e2e/**', 'worker/**'],
    },
  }
})
