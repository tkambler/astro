import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './shell/App'
import './shell/style.css'
import '@mdxeditor/editor/style.css'

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
