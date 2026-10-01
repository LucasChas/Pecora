import { useEffect, useState } from 'react'
import type { Categoria } from '../../types'
import { money } from '../../lib/format'
import {
  REDONDEOS,
  ajustarPrecios,
  errorPorcentaje,
  porcentajeDe,
  type CambioPrecio,
} from '../../lib/precios'
import { useDialog } from '../../context/DialogContext'
import { useCerrarConAtras } from '../../hooks/useCerrarConAtras'

interface Props {
  open: boolean
  categorias: Categoria[]
  onClose: () => void
  onChanged: () => void
}

// Cuántas filas de la vista previa se muestran (el resto se resume).
const FILAS_PREVIA = 30

// Hoja "Ajustar precios": sube o baja un porcentaje todos los precios (o los
// de una categoría), con redondeo opcional. Primero muestra antes → después y
// recién al confirmar los cambia, todos juntos.
export default function AjustarPreciosSheet({ open, categorias, onClose, onChanged }: Props) {
  const { confirmar, notificar } = useDialog()
  const [porcentaje, setPorcentaje] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [redondeo, setRedondeo] = useState(100)
  const [cambios, setCambios] = useState<CambioPrecio[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPorcentaje('')
    setCategoriaId('')
    setRedondeo(100)
    setCambios(null)
    setError(null)
  }, [open])

  const errorEntrada = porcentaje.trim() === '' ? null : errorPorcentaje(porcentaje)
  const opciones = {
    porcentaje: porcentajeDe(porcentaje),
    categoriaId: categoriaId || null,
    redondeo,
  }

  // Vista previa: se pide sola, medio segundo después de dejar de escribir.
  useEffect(() => {
    if (!open || porcentaje.trim() === '' || errorPorcentaje(porcentaje)) {
      setCambios(null)
      setCargando(false)
      return
    }
    let vigente = true
    const t = setTimeout(async () => {
      setCargando(true)
      const r = await ajustarPrecios(opciones, true)
      if (!vigente) return
      setCargando(false)
      if ('error' in r) {
        setError(r.error)
        setCambios(null)
      } else {
        setError(null)
        setCambios(r.cambios)
      }
    }, 500)
    return () => {
      vigente = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, porcentaje, categoriaId, redondeo])

  useCerrarConAtras(open, () => {
    if (aplicando) return false
    onClose()
  })

  async function aplicar() {
    if (!cambios || cambios.length === 0) return
    const signo = opciones.porcentaje > 0 ? '+' : ''
    const ok = await confirmar({
      titulo: `¿Cambiar ${cambios.length} precio${cambios.length === 1 ? '' : 's'}?`,
      mensaje: `${signo}${opciones.porcentaje} %${redondeo ? `, redondeado a $${redondeo}` : ''}. Se ve en el muestrario al instante.`,
      textoOk: 'Cambiar precios',
    })
    if (!ok) return
    setAplicando(true)
    const r = await ajustarPrecios(opciones, false)
    setAplicando(false)
    if ('error' in r) {
      setError(r.error)
      return
    }
    onChanged()
    onClose()
    notificar(`${r.cambios.length} precio${r.cambios.length === 1 ? '' : 's'} actualizado${r.cambios.length === 1 ? '' : 's'}`)
  }

  return (
    <div
      className={open ? 'overlay open' : 'overlay'}
      onClick={(e) => {
        if (e.target === e.currentTarget && !aplicando) onClose()
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="ajustar-precios-titulo">
        <div className="handle" />
        <h2 id="ajustar-precios-titulo">Ajustar precios</h2>
        <p className="sheet-sub">
          Subí o bajá todos los precios de una vez. Primero ves cómo quedan y después confirmás.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void aplicar()
          }}
        >
          <div className="row2">
            <div className="field">
              <label htmlFor="ajuste-porcentaje">Porcentaje (%)</label>
              <input
                id="ajuste-porcentaje"
                type="text"
                inputMode="decimal"
                value={porcentaje}
                onChange={(e) => setPorcentaje(e.target.value)}
                placeholder="Ej: 10 o -5"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="ajuste-redondeo">Redondeo</label>
              <select
                id="ajuste-redondeo"
                value={redondeo}
                onChange={(e) => setRedondeo(Number(e.target.value))}
              >
                {REDONDEOS.map((r) => (
                  <option key={r.valor} value={r.valor}>
                    {r.texto}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="ajuste-categoria">Productos</label>
            <select id="ajuste-categoria" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
              <option value="">Todos</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  Solo {c.nombre}
                </option>
              ))}
            </select>
          </div>

          {errorEntrada && <p className="form-error">{errorEntrada}</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          {cargando && !cambios && <p className="ajuste-nota">Calculando…</p>}
          {cambios && cambios.length === 0 && (
            <p className="ajuste-nota">
              Con ese ajuste no cambia ningún precio. Si redondeás a un monto grande, los
              precios que se moverían al revés (o quedarían en $0) se dejan igual.
            </p>
          )}
          {cambios && cambios.length > 0 && (
            <div className="ajuste-previa" aria-live="polite">
              <p className="ajuste-nota">
                Cambian {cambios.length} precio{cambios.length === 1 ? '' : 's'}:
              </p>
              <ul>
                {cambios.slice(0, FILAS_PREVIA).map((c) => (
                  <li key={c.id}>
                    <span className="ajuste-nombre">{c.nombre}</span>
                    <span className="ajuste-montos">
                      <s>{money(c.antes)}</s> → <strong>{money(c.despues)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
              {cambios.length > FILAS_PREVIA && (
                <p className="ajuste-nota">y {cambios.length - FILAS_PREVIA} más.</p>
              )}
            </div>
          )}

          <div className="sheet-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!cambios || cambios.length === 0 || aplicando || cargando}
            >
              {aplicando
                ? 'Aplicando…'
                : cambios?.length
                  ? `Cambiar ${cambios.length} precio${cambios.length === 1 ? '' : 's'}`
                  : 'Cambiar precios'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={aplicando}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
