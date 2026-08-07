import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import PasswordInput from '../components/common/PasswordInput'
import { useAuth } from '../context/AuthContext'
import '../styles/catalog.css'
import '../styles/account.css'

// Página de cuenta de clientas (/cuenta): ingresar o crear cuenta. Al entrar,
// redirige a "next" (ej. el checkout desde el que vino) o a "Mis pedidos".
export default function AccountPage() {
  const { session, ingresar, registrar, recuperarPassword } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/'

  const [modo, setModo] = useState<'ingresar' | 'registrar' | 'recuperar'>('ingresar')
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
      if (modo === 'recuperar') {
        const { error } = await recuperarPassword(email)
        if (error) setError(error)
        // Mismo aviso exista o no la cuenta: Supabase no distingue por error
        // para no revelar qué emails están registrados.
        else setAviso('Si ese email tiene una cuenta, te mandamos un link para restablecer la contraseña. Revisá también la carpeta de spam.')
      } else if (modo === 'ingresar') {
        const { error } = await ingresar(email, password)
        if (error) setError(error)
        else navigate(next, { replace: true })
      } else {
        const { error, necesitaConfirmar, yaRegistrado } = await registrar({
          email,
          password,
          nombre,
          telefono,
        })
        if (error) setError(error)
        else if (yaRegistrado) {
          // La saltamos directo a "Ingresar" con el email ya cargado: es un
          // paso menos que un texto suelto, y no le promete una recuperación
          // de contraseña que la app todavía no tiene.
          setModo('ingresar')
          setAviso('Ese email ya tiene una cuenta. Ingresá tu contraseña para entrar.')
        } else if (necesitaConfirmar)
          setAviso(
            'Ya casi está: te mandamos un email para confirmar tu cuenta. Abrilo y tocá el enlace para poder ingresar. ¿No lo ves? Revisá también la carpeta de spam.',
          )
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
        {/* TODO(owner-copy): confirmar el texto final del título. */}
        <h1 className="cart-title">Tu cuenta</h1>
        <div className="account-card">
          {modo !== 'recuperar' && (
            <div className="account-tabs">
              <button className={modo === 'ingresar' ? 'active' : ''} onClick={() => { setModo('ingresar'); setError(null); setAviso(null) }}>
                Ingresar
              </button>
              <button className={modo === 'registrar' ? 'active' : ''} onClick={() => { setModo('registrar'); setError(null); setAviso(null) }}>
                Crear cuenta
              </button>
            </div>
          )}

          <p className="account-intro">
            {modo === 'ingresar'
              ? 'Ingresá para ver tus pedidos y finalizar tu compra.'
              : modo === 'registrar'
                ? 'Creá tu cuenta de Pecora para comprar y seguir tus pedidos.'
                : 'Ingresá tu email y te mandamos un link para elegir una contraseña nueva.'}
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
            {modo !== 'recuperar' && (
              <div className="field">
                <label>Contraseña</label>
                <PasswordInput
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  autoComplete={modo === 'ingresar' ? 'current-password' : 'new-password'}
                />
              </div>
            )}
            {modo === 'ingresar' && (
              <button
                type="button"
                className="account-link-btn"
                onClick={() => { setModo('recuperar'); setError(null); setAviso(null) }}
              >
                ¿Olvidaste tu contraseña?
              </button>
            )}

            {aviso && <p className="account-aviso">{aviso}</p>}
            {error && <p className="form-error">{error}</p>}

            <button type="submit" className="btn btn-primary" disabled={cargando}>
              {cargando
                ? 'Procesando…'
                : modo === 'ingresar'
                  ? 'Ingresar'
                  : modo === 'registrar'
                    ? 'Crear cuenta'
                    : 'Enviar link de recuperación'}
            </button>
          </form>

          {modo === 'recuperar' ? (
            <button type="button" className="pp-back" onClick={() => { setModo('ingresar'); setError(null); setAviso(null) }}>
              ← Volver a ingresar
            </button>
          ) : (
            <Link className="pp-back" to="/">
              ← Volver al muestrario
            </Link>
          )}
        </div>
      </main>
    </div>
  )
}
