import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { bootstrapTheme } from './theme'
import './styles/index.css'

// Apply the saved appearance before first paint to avoid a light-flash.
bootstrapTheme()

// Drops outside an explicit drop zone must never trigger Chromium's default
// file:// navigation, which would replace the app UI.
window.addEventListener('dragover', (event) => event.preventDefault())
window.addEventListener('drop', (event) => event.preventDefault())

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
