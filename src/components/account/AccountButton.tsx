import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

// Botón de cuenta en el header: si no hay sesión lleva a /cuenta; si hay,
// abre un mini menú con "Mis pedidos" y "Salir".
export default function AccountButton() {
  const { session, perfil, salir } = useAuth()
  const [abierto, setAbierto] = useState(false)
  const navigate = useNavigate()

  const icono = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  )

  if (!session) {
    return (
      <Link to="/cuenta" className="cart-icon" aria-label="Ingresar" title="Ingresar">
        {icono}
      </Link>
    )
  }

  async function onSalir() {
    setAbierto(false)
    await salir()
    navigate('/')
  }

  return (
    <div className="account-menu-wrap">
      <button className="cart-icon" onClick={() => setAbierto((v) => !v)} aria-label="Mi cuenta" title="Mi cuenta">
        {icono}
      </button>
      {abierto && (
        <>
          <div className="account-menu-backdrop" onClick={() => setAbierto(false)} />
          <div className="account-menu">
            {/* Identidad de la cuenta: nombre y email de quien está logueada. */}
            <div className="account-menu-id">
              <span className="account-menu-nombre">
                {perfil?.nombre || 'Mi cuenta'}
              </span>
              <span className="account-menu-email">{session.user.email}</span>
            </div>
            <Link to="/mis-pedidos" onClick={() => setAbierto(false)}>
              Mis pedidos
            </Link>
            <button onClick={onSalir}>Salir</button>
          </div>
        </>
      )}
    </div>
  )
}
