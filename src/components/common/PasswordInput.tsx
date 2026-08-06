import { useState } from 'react'
// Estilo importado por el propio componente (no por admin.css/catalog.css):
// LoginForm (admin) y AccountPage (catalog) cargan hojas de estilo distintas,
// así que un componente compartido necesita su propio CSS en vez de duplicar
// las reglas en ambas hojas. Primer caso de import de CSS "scoped" al
// componente en este repo — convención deliberada, no un descuido.
import '../../styles/password-input.css'

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>

// Input de contraseña con botón de mostrar/ocultar. Reemplaza los
// <input type="password"> crudos de LoginForm (admin) y AccountPage
// (clientas); todas las props (required, autoComplete, minLength, value,
// onChange, etc.) pasan directo al input interno.
export default function PasswordInput(props: Props) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="pw-wrap">
      <input type={visible ? 'text' : 'password'} {...props} />
      <button
        type="button"
        className="pw-toggle"
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 3l18 18" strokeLinecap="round" />
            <path
              d="M10.58 10.58a2 2 0 002.83 2.83M9.36 5.6A9.77 9.77 0 0112 5c5 0 9 4.5 10 7-.35 1-.98 2.14-1.84 3.24M6.6 6.6C4.3 8.03 2.7 10.06 2 12c1 2.5 5 7 10 7 1.35 0 2.62-.28 3.76-.77"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  )
}
