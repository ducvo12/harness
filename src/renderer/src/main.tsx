import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/index.css'

const Shell = window.location.hash === '#legacy-shell'
  ? (await import('./app/App')).default
  : (await import('./app/WorkspaceApp')).default

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Shell />
  </React.StrictMode>
)
