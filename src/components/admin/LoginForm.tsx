import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Logo from '../Logo'

// Pantalla de login (email + contraseña) previa a entrar al panel /admin.
// Al iniciar sesión, useAuth detecta la nueva sesión y AdminPage muestra el panel.
export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setCargando(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('No pudimos iniciar sesión. Revisá el email y la contraseña.')
    setCargando(false)
  }

  return (
    <form className="login-root" onSubmit={onSubmit}>
      <Logo className="login-logo" />
      <div>
        <h1>Panel de Pecora</h1>
        <p className="sub">Ingresá para administrar el muestrario.</p>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="field">
        <label>Email</label>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com"
        />
      </div>

      <div className="field">
        <label>Contraseña</label>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
      </div>

      <div className="sheet-actions">
        <button type="submit" className="btn btn-primary" disabled={cargando}>
          {cargando ? 'Ingresando…' : 'Ingresar'}
        </button>
      </div>
    </form>
  )
}
