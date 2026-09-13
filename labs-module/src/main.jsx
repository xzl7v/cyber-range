import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import HostApp from './HostApp.jsx'
import './styles.css'
import './standalone.css'

const hostMode = window.location.pathname === '/app' || window.location.pathname.startsWith('/app/')
createRoot(document.getElementById('root')).render(<React.StrictMode>{hostMode ? <HostApp /> : <App />}</React.StrictMode>)
