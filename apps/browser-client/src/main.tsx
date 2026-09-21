import React from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './shell/App'
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

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
