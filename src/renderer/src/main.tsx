import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App'
import './styles/index.css'

const Shell = window.location.hash === '#workspace'
  ? (await import('./app/WorkspaceApp')).default
  : App

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Shell />
  </React.StrictMode>
)
