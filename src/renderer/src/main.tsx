import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { bootstrapTheme } from './theme'
import './styles/index.css'

// Apply the saved appearance before first paint to avoid a light-flash.
bootstrapTheme()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
