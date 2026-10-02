import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import PasswordInput from '../components/common/PasswordInput'
import { useAuth } from '../context/AuthContext'
import '../styles/catalog.css'
import '../styles/account.css'
import { useTitulo } from '../hooks/useTitulo'

// Página de cuenta de clientas (/cuenta): ingresar o crear cuenta. Al entrar,
// redirige a "next" (ej. el checkout desde el que vino) o a "Mis pedidos".
export default function AccountPage() {
  const { session, ingresar, registrar, recuperarPassword, reenviarConfirmacion } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/'

  const [modo, setModo] = useState<'ingresar' | 'registrar' | 'recuperar'>('ingresar')
  useTitulo(modo === 'registrar' ? 'Crear cuenta' : modo === 'recuperar' ? 'Recuperar contraseña' : 'Ingresar')
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // Email de una cuenta que existe pero no confirmó: ofrece reenviar el mail.
  const [sinConfirmar, setSinConfirmar] = useState<string | null>(null)

  function cambiarModo(m: typeof modo) {
    setModo(m)
    setError(null)
    setAviso(null)
    setSinConfirmar(null)
  }

  async function reenviar() {
    if (!sinConfirmar) return
    setCargando(true)
    const { error } = await reenviarConfirmacion(sinConfirmar, next)
    setCargando(false)
    if (error) setError(error)
    else {
      setError(null)
      setSinConfirmar(null)
      setAviso(`Te reenviamos el mail de confirmación a ${sinConfirmar}. Revisá también spam.`)
    }
  }

  // Si ya está logueada, no tiene sentido esta página: la mandamos a "next"
  // (o a "Mi cuenta" si entró directo a /cuenta).
  useEffect(() => {
    if (session) navigate(params.has('next') ? next : '/mi-cuenta', { replace: true })
  }, [session, next, params, navigate])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setAviso(null)
    setSinConfirmar(null)
    setCargando(true)
    try {
      if (modo === 'recuperar') {
        const { error } = await recuperarPassword(email)
        if (error) setError(error)
        // Mismo aviso exista o no la cuenta: Supabase no distingue por error
        // para no revelar qué emails están registrados.
        else setAviso('Si ese email tiene una cuenta, te mandamos un link para restablecer la contraseña. Revisá también la carpeta de spam.')
      } else if (modo === 'ingresar') {
        const { error, sinConfirmar } = await ingresar(email, password)
        if (error) {
          setError(error)
          if (sinConfirmar) setSinConfirmar(email)
        } else navigate(next, { replace: true })
      } else {
        const { error, necesitaConfirmar, yaRegistrado } = await registrar(
          { email, password, nombre, telefono },
          next,
        )
        if (error) setError(error)
        else if (yaRegistrado) {
          // La saltamos directo a "Ingresar" con el email ya cargado: es un
          // paso menos que un texto suelto, y no le promete una recuperación
          // de contraseña que la app todavía no tiene.
          setModo('ingresar')
          setAviso('Ese email ya tiene una cuenta. Ingresá tu contraseña para entrar.')
        } else if (necesitaConfirmar)
          setAviso(
            next.startsWith('/checkout')
              ? 'Ya casi está: te mandamos un email para confirmar tu cuenta. Tocá el enlace y volvés directo a terminar tu compra (tu carrito queda guardado). ¿No lo ves? Revisá también spam.'
              : 'Ya casi está: te mandamos un email para confirmar tu cuenta. Abrilo y tocá el enlace para poder ingresar. ¿No lo ves? Revisá también la carpeta de spam.',
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
              <button className={modo === 'ingresar' ? 'active' : ''} onClick={() => cambiarModo('ingresar')}>
                Ingresar
              </button>
              <button className={modo === 'registrar' ? 'active' : ''} onClick={() => cambiarModo('registrar')}>
                Crear cuenta
              </button>
            </div>
          )}

          <p className="account-intro">
            {modo === 'ingresar'
              ? 'Ingresá para ver tus pedidos, usar tus direcciones y cupones.'
              : modo === 'registrar'
                ? 'Creá tu cuenta de Pecora para seguir tus pedidos y guardar tus datos.'
                : 'Ingresá tu email y te mandamos un link para elegir una contraseña nueva.'}
          </p>

          {next === '/checkout' && modo !== 'recuperar' && (
            <p className="account-intro account-invitada">
              ¿Preferís no crear una cuenta? <Link to="/checkout">Seguí como invitada</Link>.
            </p>
          )}

          <form onSubmit={onSubmit} className="account-form">
            {modo === 'registrar' && (
              <>
                <div className="field">
                  <label htmlFor="cuenta-nombre">Nombre y apellido</label>
                  <input id="cuenta-nombre" type="text" required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Ana Pérez" autoComplete="name" />
                </div>
                <div className="field">
                  <label htmlFor="cuenta-telefono">Teléfono (WhatsApp)</label>
                  <input id="cuenta-telefono" type="tel" required value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Ej: 3541 123456" autoComplete="tel" />
                </div>
              </>
            )}
            <div className="field">
              <label htmlFor="cuenta-email">Email</label>
              <input id="cuenta-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" autoComplete="email" />
            </div>
            {modo !== 'recuperar' && (
              <div className="field">
                <label htmlFor="cuenta-password">Contraseña</label>
                <PasswordInput
                  id="cuenta-password"
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
                onClick={() => cambiarModo('recuperar')}
              >
                ¿Olvidaste tu contraseña?
              </button>
            )}

            {aviso && (
              <p className="account-aviso" role="status">
                {aviso}
              </p>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {sinConfirmar && (
              <button type="button" className="account-link-btn" onClick={reenviar} disabled={cargando}>
                Reenviar el mail de confirmación
              </button>
            )}

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
            <button type="button" className="pp-back" onClick={() => cambiarModo('ingresar')}>
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
