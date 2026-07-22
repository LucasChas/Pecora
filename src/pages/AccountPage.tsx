import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import { useAuth } from '../context/AuthContext'
import '../styles/catalog.css'
import '../styles/account.css'

// Página de cuenta de clientas (/cuenta): ingresar o crear cuenta. Al entrar,
// redirige a "next" (ej. el checkout desde el que vino) o a "Mis pedidos".
export default function AccountPage() {
  const { session, ingresar, registrar } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/mis-pedidos'

  const [modo, setModo] = useState<'ingresar' | 'registrar'>('ingresar')
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // Si ya está logueada, no tiene sentido esta página: la mandamos a "next".
  useEffect(() => {
    if (session) navigate(next, { replace: true })
  }, [session, next, navigate])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setAviso(null)
    setCargando(true)
    try {
      if (modo === 'ingresar') {
        const { error } = await ingresar(email, password)
        if (error) setError(error)
        else navigate(next, { replace: true })
      } else {
        const { error, necesitaConfirmar } = await registrar({ email, password, nombre, telefono })
        if (error) setError(error)
        else if (necesitaConfirmar)
          setAviso('¡Cuenta creada! Revisá tu email para confirmarla y después ingresá.')
        else navigate(next, { replace: true })
      }
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="catalog-root">
      <header className="cart-header">
        <Link to="/">
          <Logo />
        </Link>
      </header>
      <Scallop />

      <main className="account">
        <div className="account-card">
          <div className="account-tabs">
            <button className={modo === 'ingresar' ? 'active' : ''} onClick={() => setModo('ingresar')}>
              Ingresar
            </button>
            <button className={modo === 'registrar' ? 'active' : ''} onClick={() => setModo('registrar')}>
              Crear cuenta
            </button>
          </div>

          <p className="account-intro">
            {modo === 'ingresar'
              ? 'Ingresá para ver tus pedidos y finalizar tu compra.'
              : 'Creá tu cuenta de Pecora para comprar y seguir tus pedidos.'}
          </p>

          <form onSubmit={onSubmit} className="account-form">
            {modo === 'registrar' && (
              <>
                <div className="field">
                  <label>Nombre y apellido</label>
                  <input type="text" required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Ana Pérez" />
                </div>
                <div className="field">
                  <label>Teléfono (WhatsApp)</label>
                  <input type="tel" required value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Ej: 3541 123456" />
                </div>
              </>
            )}
            <div className="field">
              <label>Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" autoComplete="email" />
            </div>
            <div className="field">
              <label>Contraseña</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                autoComplete={modo === 'ingresar' ? 'current-password' : 'new-password'}
              />
            </div>

            {aviso && <p className="account-aviso">{aviso}</p>}
            {error && <p className="form-error">{error}</p>}

            <button type="submit" className="btn btn-primary" disabled={cargando}>
              {cargando ? 'Procesando…' : modo === 'ingresar' ? 'Ingresar' : 'Crear cuenta'}
            </button>
          </form>

          <Link className="pp-back" to="/">
            ← Volver al muestrario
          </Link>
        </div>
      </main>
    </div>
  )
}
