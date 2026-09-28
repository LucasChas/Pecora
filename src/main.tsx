import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/common/ErrorBoundary'
import { AuthProvider } from './context/AuthContext'
import { CartProvider } from './context/CartContext'
import { DialogProvider } from './context/DialogContext'
import './styles/tokens.css'
import './styles/global.css'

// ErrorBoundary por fuera de los providers: también cubre un error en ellos
// (ej. el carrito leyendo localStorage), no solo en las páginas.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <DialogProvider>
        <AuthProvider>
          <CartProvider>
            <App />
          </CartProvider>
        </AuthProvider>
      </DialogProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
