import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { GlobalLoadingOverlay } from './components/GlobalLoadingOverlay'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <GlobalLoadingOverlay />
  </StrictMode>,
)

if (import.meta.env.PROD) {
  registerSW({ immediate: true })
}
