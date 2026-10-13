import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AccountProvider } from './account/AccountProvider'
import { createLocalBackend } from './account/localBackend'
import { setAssetBackend } from './document/assets'
import { Root } from './Root'

// The one place that decides where data lives. A Supabase backend replaces
// this line and nothing else.
const backend = createLocalBackend()
setAssetBackend(backend.assets)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccountProvider backend={backend}>
      <Root />
    </AccountProvider>
  </StrictMode>,
)
