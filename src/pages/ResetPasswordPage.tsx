import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import PasswordInput from '../components/common/PasswordInput'
import { useAuth } from '../context/AuthContext'
import '../styles/catalog.css'
import '../styles/account.css'

// Página que abre el link del mail de recuperación (/restablecer-contrasena).
// Al cargar esta URL, supabase-js detecta el token del hash y crea una
// sesión temporal (evento PASSWORD_RECOVERY) — con esa sesión ya se puede
// llamar updateUser({ password }) sin pedir la contraseña vieja.
export default function ResetPasswordPage() {
  const { session, actualizarPassword } = useAuth()
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState(false)
  const [linkInvalido, setLinkInvalido] = useState(false)

  // Le damos un margen a Supabase para procesar el token del hash antes de
  // asumir que el link es inválido o ya venció.
  useEffect(() => {
    if (session) {
      setListo(true)
      return
    }
    const timer = setTimeout(() => {
      if (!session) setLinkInvalido(true)
    }, 2500)
    return () => clearTimeout(timer)
  }, [session])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirmar) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setCargando(true)
    try {
      const { error } = await actualizarPassword(password)
      if (error) {
        setError(error)
        return
      }
      // El aviso de "contraseña cambiada" lo manda Supabase Auth solo (la
      // notificación de seguridad nativa, configurada en el dashboard) — no
      // hace falta dispararlo desde acá.
      navigate('/mis-pedidos', { replace: true })
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
        <h1 className="cart-title">Nueva contraseña</h1>
        <div className="account-card">
          {linkInvalido ? (
            <>
              <p className="account-intro">
                Este link de recuperación no es válido o ya venció. Pedí uno nuevo desde "¿Olvidaste tu contraseña?" en la pantalla de ingreso.
              </p>
              <Link className="btn btn-primary" to="/cuenta">
                Volver a ingresar
              </Link>
            </>
          ) : !listo ? (
            <p className="account-intro">Verificando el link…</p>
          ) : (
            <form onSubmit={onSubmit} className="account-form">
              <p className="account-intro">Elegí tu nueva contraseña.</p>
              <div className="field">
                <label>Contraseña nueva</label>
                <PasswordInput
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  autoComplete="new-password"
                />
              </div>
              <div className="field">
                <label>Repetir contraseña</label>
                <PasswordInput
                  required
                  minLength={6}
                  value={confirmar}
                  onChange={(e) => setConfirmar(e.target.value)}
                  placeholder="Repetí la contraseña"
                  autoComplete="new-password"
                />
              </div>

              {error && <p className="form-error">{error}</p>}

              <button type="submit" className="btn btn-primary" disabled={cargando}>
                {cargando ? 'Guardando…' : 'Guardar contraseña'}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}
