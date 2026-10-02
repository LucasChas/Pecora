import { useEffect, useRef, useState } from 'react'
import {
  guardarPreferencia,
  notificacionesDisponibles,
  pedirPermiso,
  sonarAviso,
  type PreferenciaAvisos,
} from '../../lib/avisoPedidoNuevo'

interface Props {
  preferencia: PreferenciaAvisos
  onCambiar: (p: PreferenciaAvisos) => void
}

// Botón "Avisos" de la vista Pedidos: sonido y notificación del sistema al
// entrar un pedido, elegidos por dispositivo.
export default function AvisosPedidos({ preferencia, onCambiar }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const raiz = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    const cerrar = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !raiz.current?.contains(e.target as Node)) {
        setAbierto(false)
      }
    }
    document.addEventListener('mousedown', cerrar)
    document.addEventListener('keydown', cerrar)
    return () => {
      document.removeEventListener('mousedown', cerrar)
      document.removeEventListener('keydown', cerrar)
    }
  }, [abierto])

  function cambiar(p: PreferenciaAvisos) {
    guardarPreferencia(p)
    onCambiar(p)
  }

  async function cambiarSistema(activar: boolean) {
    setMensaje(null)
    if (!activar) {
      cambiar({ ...preferencia, sistema: false })
      return
    }
    const ok = await pedirPermiso()
    if (ok) cambiar({ ...preferencia, sistema: true })
    else
      setMensaje(
        'El navegador no dio permiso. Habilitá las notificaciones para este sitio en la configuración del navegador.',
      )
  }

  const activos = preferencia.sonido || preferencia.sistema

  return (
    <div className="avisos-ped" ref={raiz}>
      <button
        type="button"
        className="head-action"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
      >
        <span aria-hidden="true">{activos ? '🔔' : '🔕'}</span> Avisos
      </button>
      {abierto && (
        <div className="avisos-ped-panel" role="group" aria-label="Avisos de pedidos nuevos">
          <p className="avisos-ped-titulo">Cuando entra un pedido</p>
          <label>
            <input
              type="checkbox"
              checked={preferencia.sonido}
              onChange={(e) => {
                cambiar({ ...preferencia, sonido: e.target.checked })
                if (e.target.checked) sonarAviso()
              }}
            />
            Sonar en este dispositivo
          </label>
          {notificacionesDisponibles() && (
            <label>
              <input
                type="checkbox"
                checked={preferencia.sistema && Notification.permission === 'granted'}
                onChange={(e) => void cambiarSistema(e.target.checked)}
              />
              Notificación aunque el panel esté minimizado
            </label>
          )}
          {mensaje && <p className="avisos-ped-msg">{mensaje}</p>}
          <p className="avisos-ped-nota">Con el panel cerrado, el aviso te llega por mail.</p>
        </div>
      )}
    </div>
  )
}
