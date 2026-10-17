import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AccountProvider } from './account/AccountProvider'
import { createCloudBackend } from './account/cloud/cloudBackend'
import { createLocalBackend } from './account/localBackend'
import { setAssetBackend } from './document/assets'
import { Root } from './Root'

// The one place that decides where data lives: Cloudflare when built with
// VITE_BACKEND=cloud (npm run dev:cloud / build:cloud), this browser otherwise.
const backend = import.meta.env.VITE_BACKEND === 'cloud' ? createCloudBackend() : createLocalBackend()
setAssetBackend(backend.assets)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccountProvider backend={backend}>
      <Root />
    </AccountProvider>
  </StrictMode>,
)
