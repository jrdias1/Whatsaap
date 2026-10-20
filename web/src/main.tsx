import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './legibility.css'
import AcceptInvitation from './AcceptInvitation.tsx'
import CompletePasswordRecovery from './CompletePasswordRecovery.tsx'

const Page = window.location.pathname === '/accept-invitation' ? AcceptInvitation : window.location.pathname === '/password-recovery' ? CompletePasswordRecovery : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
