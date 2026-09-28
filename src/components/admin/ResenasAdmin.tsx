import { useCallback, useEffect, useState } from 'react'
import type { ResenaModeracion } from '../../types'
import { useDialog } from '../../context/DialogContext'
import { formatearFechaResena, listarResenasModeracion, ocultarResena, textoEstrellas } from '../../lib/resenas'
import { Estrellas } from '../catalog/ResenasProducto'
import '../../styles/resenas.css'

type Filtro = 'todas' | 'ocultas'

type Carga =
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje: string }
  | { estado: 'listo'; resenas: ResenaModeracion[] }

// Ajustes → Reseñas: moderación (solo admin). Ocultar no borra: la reseña deja
// de verse en la tienda y se puede volver a mostrar. La autora la sigue viendo
// en su cuenta como "oculta".
export default function ResenasAdmin() {
  const { avisar } = useDialog()
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [carga, setCarga] = useState<Carga>({ estado: 'cargando' })
  const [cambiando, setCambiando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCarga({ estado: 'cargando' })
    const r = await listarResenasModeracion(filtro === 'ocultas')
    setCarga(r.ok ? { estado: 'listo', resenas: r.valor } : { estado: 'error', mensaje: r.error })
  }, [filtro])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function alternar(r: ResenaModeracion) {
    setCambiando(r.id)
    const res = await ocultarResena(r.id, !r.oculta)
    setCambiando(null)
    if (!res.ok) {
      await avisar({ titulo: 'No se pudo actualizar la reseña', mensaje: res.error })
      return
    }
    // Actualiza en el lugar (sin recargar toda la lista). Con el filtro
    // "ocultas", la que se vuelve a mostrar sale de la lista.
    setCarga((c) => {
      if (c.estado !== 'listo') return c
      const resenas = c.resenas
        .map((x) => (x.id === r.id ? { ...x, oculta: !r.oculta } : x))
        .filter((x) => filtro === 'todas' || x.oculta)
      return { estado: 'listo', resenas }
    })
  }

  return (
    <>
      <div className="ajustes-subhead">
        <p>Opiniones de compradoras verificadas. Ocultá las que no correspondan: no se borran.</p>
      </div>

      <div className="orders-tools">
        <div className="orders-chips" role="group" aria-label="Filtrar reseñas">
          {(['todas', 'ocultas'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={filtro === f ? 'chip active' : 'chip'}
              aria-pressed={filtro === f}
              onClick={() => setFiltro(f)}
            >
              {f === 'todas' ? 'Todas' : 'Ocultas'}
            </button>
          ))}
        </div>
      </div>

      <div className="list list--ajustes">
        {carga.estado === 'cargando' ? (
          <div className="empty">Cargando reseñas…</div>
        ) : carga.estado === 'error' ? (
          <>
            <div className="empty" role="alert">
              No pudimos cargar las reseñas.
              <br />
              {carga.mensaje}
            </div>
            <button className="orders-mas" onClick={() => void cargar()}>
              Reintentar
            </button>
          </>
        ) : carga.resenas.length === 0 ? (
          <div className="empty">
            {filtro === 'ocultas' ? 'No hay reseñas ocultas.' : 'Todavía no hay reseñas.'}
          </div>
        ) : (
          carga.resenas.map((r) => (
            <div className={r.oculta ? 'ajuste-card ajuste-card--off' : 'ajuste-card'} key={r.id}>
              <div className="ajuste-top">
                <span className="ajuste-titulo">{r.producto_nombre}</span>
                <span className={`ajuste-estado ajuste-estado--${r.oculta ? 'inactivo' : 'activo'}`}>
                  {r.oculta ? 'Oculta' : 'Visible'}
                </span>
              </div>
              <div className="rs-admin-linea">
                <Estrellas llenas={r.estrellas} etiqueta={textoEstrellas(r.estrellas)} />
                <span className="ajuste-meta">
                  {r.nombre_corto}
                  {r.created_at && ` · ${formatearFechaResena(r.created_at)}`}
                </span>
              </div>
              {r.comentario ? (
                <p className="ajuste-desc rs-admin-comentario">{r.comentario}</p>
              ) : (
                <p className="ajuste-meta">Sin comentario.</p>
              )}
              <div className="ajuste-acciones">
                <button
                  type="button"
                  className={r.oculta ? 'ajuste-btn' : 'ajuste-btn ajuste-btn--peligro'}
                  onClick={() => void alternar(r)}
                  disabled={cambiando === r.id}
                >
                  {cambiando === r.id ? 'Guardando…' : r.oculta ? 'Mostrar' : 'Ocultar'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}
