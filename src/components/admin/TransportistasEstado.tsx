import { useCallback, useEffect, useState } from 'react'
import {
  TRANSPORTISTAS,
  consultarEstadoTransportistas,
  nombreTransportista,
  type EstadoTransportistas,
} from '../../lib/transportistas'

// Estado de Andreani y Correo Argentino (Ajustes → Zonas de envío): cuáles
// tienen credenciales cargadas, según la Edge Function cotizar-envio. Solo
// informa: las credenciales son secretos de Supabase que carga la dueña.
export default function TransportistasEstado() {
  const [estado, setEstado] = useState<EstadoTransportistas | null>(null)
  const [consultando, setConsultando] = useState(false)

  const consultar = useCallback(async () => {
    setConsultando(true)
    const r = await consultarEstadoTransportistas()
    setEstado(r)
    setConsultando(false)
  }, [])

  useEffect(() => {
    void consultar()
  }, [consultar])

  const activos = estado?.ok ? estado.activos : []

  return (
    <section className="transportistas-estado" aria-labelledby="transportistas-titulo" aria-busy={consultando}>
      <h2 id="transportistas-titulo">Transportistas</h2>

      {estado === null ? (
        <p className="transportistas-nota">Consultando…</p>
      ) : estado.ok ? (
        <ul className="transportistas-lista">
          {TRANSPORTISTAS.map((t) => {
            const activo = activos.includes(t)
            return (
              <li key={t}>
                <span>{nombreTransportista(t)}</span>
                <span className={`ajuste-estado ajuste-estado--${activo ? 'activo' : 'inactivo'}`}>
                  {activo ? 'Activo' : 'Sin credenciales'}
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="transportistas-nota" role="status">
          {estado.motivo === 'sin_funcion'
            ? 'La cotización con transportistas todavía no está desplegada (función cotizar-envio).'
            : 'No pudimos consultar el estado de los transportistas.'}
        </p>
      )}

      <p className="transportistas-nota">
        {activos.length > 0
          ? 'En el checkout se ofrecen los transportistas activos junto al envío por zona.'
          : 'Mientras no haya transportistas activos, el envío se cobra según las zonas de abajo.'}{' '}
        Las credenciales de cada transportista las configura la dueña como secretos de Supabase
        (Edge Functions → Secrets); no se cargan desde el panel.
      </p>

      {estado !== null && !(estado.ok === false && estado.motivo === 'sin_funcion') && (
        <button type="button" className="ajuste-btn" onClick={consultar} disabled={consultando}>
          {consultando ? 'Consultando…' : 'Volver a consultar'}
        </button>
      )}
    </section>
  )
}
