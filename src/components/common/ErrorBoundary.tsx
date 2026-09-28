import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// Red de seguridad de toda la app: si un componente tira un error al
// renderizar, en vez de quedar la pantalla en blanco se muestra un aviso con
// la opción de recargar. Tiene que ser un componente de clase (React no tiene
// un hook equivalente). No atrapa errores de eventos ni de código asíncrono.
//
// Estilos inline con los tokens de marca (y valores de respaldo): se ve bien
// tanto en la tienda como en el panel admin y no depende de ningún CSS de página.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error no controlado en la interfaz:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div style={estilos.fondo} role="alert">
        <div style={estilos.tarjeta}>
          <h1 style={estilos.titulo}>Algo salió mal</h1>
          <p style={estilos.texto}>
            Tuvimos un problema al mostrar esta página. Recargala para intentar de
            nuevo; si sigue pasando, probá en unos minutos.
          </p>
          <button type="button" style={estilos.boton} onClick={() => window.location.reload()}>
            Recargar página
          </button>
        </div>
      </div>
    )
  }
}

const estilos: Record<'fondo' | 'tarjeta' | 'titulo' | 'texto' | 'boton', CSSProperties> = {
  fondo: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    background: 'var(--cream, #F8F1E1)',
    color: 'var(--ink, #3B2F22)',
    fontFamily: "'Inter', sans-serif",
  },
  tarjeta: {
    width: '100%',
    maxWidth: 420,
    background: '#fff',
    borderRadius: 'var(--radius, 14px)',
    boxShadow: '0 1px 3px rgba(51, 48, 42, 0.08)',
    padding: '32px 24px',
    textAlign: 'center',
  },
  titulo: {
    fontFamily: "'Fraunces', serif",
    fontWeight: 600,
    fontSize: '1.5rem',
    margin: '0 0 10px',
  },
  texto: {
    margin: '0 0 22px',
    fontSize: '0.92rem',
    lineHeight: 1.55,
    color: 'var(--ink-soft, #7C6E54)',
  },
  boton: {
    minHeight: 44,
    padding: '11px 26px',
    border: 'none',
    borderRadius: 100,
    background: 'var(--sage, #B08F55)',
    color: '#fff',
    fontFamily: "'Inter', sans-serif",
    fontSize: '0.92rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
}
