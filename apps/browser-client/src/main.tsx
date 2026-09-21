import React from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './shell/App'
import { SharedNote } from './shares/SharedNote'
import './shell/style.css'
import '@mdxeditor/editor/style.css'

registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    const checkForUpdate = () => { void registration?.update() }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    })
    window.setInterval(checkForUpdate, 60 * 60 * 1000)
  },
})

const lockPortrait = () => {
  const orientation = screen.orientation as ScreenOrientation & { lock?: (value: string) => Promise<void> }
  if (typeof orientation.lock === 'function') void orientation.lock('portrait').catch(() => undefined)
}
lockPortrait()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') lockPortrait()
})
document.addEventListener('pointerdown', lockPortrait, { once: true })

const sharedMatch = window.location.pathname.match(/^\/shared\/([A-Za-z0-9_-]{22})\/?$/)
createRoot(document.getElementById('root')!).render(<React.StrictMode>
  {sharedMatch ? <SharedNote id={sharedMatch[1]!} /> : <App />}
</React.StrictMode>)
