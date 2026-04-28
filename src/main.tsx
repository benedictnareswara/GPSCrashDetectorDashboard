import React from 'react'
import ReactDOM from 'react-dom/client'
import { CrashLocationDashboard } from './components/CrashLocationDashboard'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CrashLocationDashboard />
  </React.StrictMode>
)