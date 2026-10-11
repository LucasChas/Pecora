import { useEffect, useState } from 'react'
import type { Categoria } from '../../types'
import { money } from '../../lib/format'
import {
  REDONDEOS,
  ajustarPrecios,
  errorPorcentaje,
  errorPrecio,
  fijarPrecios,
  porcentajeDe,
  precioDe,
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

type Modo = 'porcentaje' | 'precio'

const MODOS: { valor: Modo; texto: string }[] = [
  { valor: 'porcentaje', texto: 'Porcentaje' },
  { valor: 'precio', texto: 'Precio fijo' },
]

// Hoja "Ajustar precios": sube o baja un porcentaje todos los precios (o los
// de una categoría), con redondeo opcional, o los deja todos en un precio
// fijo. Primero muestra antes → después y recién al confirmar los cambia,
// todos juntos.
export default function AjustarPreciosSheet({ open, categorias, onClose, onChanged }: Props) {
  const { confirmar, notificar } = useDialog()
  const [modo, setModo] = useState<Modo>('porcentaje')
  const [porcentaje, setPorcentaje] = useState('')
  const [precio, setPrecio] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [redondeo, setRedondeo] = useState(100)
  const [cambios, setCambios] = useState<CambioPrecio[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setModo('porcentaje')
    setPorcentaje('')
    setPrecio('')
    setCategoriaId('')
    setRedondeo(100)
    setCambios(null)
    setError(null)
  }, [open])

  const texto = modo === 'porcentaje' ? porcentaje : precio
  const validar = modo === 'porcentaje' ? errorPorcentaje : errorPrecio
  const errorEntrada = texto.trim() === '' ? null : validar(texto)
  const opciones = {
    porcentaje: porcentajeDe(porcentaje),
    precio: precioDe(precio) ?? 0,
    categoriaId: categoriaId || null,
    redondeo,
  }
  const pedir = (simular: boolean) =>
    modo === 'porcentaje' ? ajustarPrecios(opciones, simular) : fijarPrecios(opciones, simular)

  // Vista previa: se pide sola, medio segundo después de dejar de escribir.
  useEffect(() => {
    if (!open || texto.trim() === '' || validar(texto)) {
      setCambios(null)
      setCargando(false)
      return
    }
    let vigente = true
    const t = setTimeout(async () => {
      setCargando(true)
      const r = await pedir(true)
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
  }, [open, modo, porcentaje, precio, categoriaId, redondeo])

  useCerrarConAtras(open, () => {
    if (aplicando) return false
    onClose()
  })

  async function aplicar() {
    if (!cambios || cambios.length === 0) return
    const signo = opciones.porcentaje > 0 ? '+' : ''
    const detalle =
      modo === 'porcentaje'
        ? `${signo}${opciones.porcentaje} %${redondeo ? `, redondeado a $${redondeo}` : ''}`
        : `Todos quedan en ${money(opciones.precio)}`
    const ok = await confirmar({
      titulo: `¿Cambiar ${cambios.length} precio${cambios.length === 1 ? '' : 's'}?`,
      mensaje: `${detalle}. Se ve en el muestrario al instante.`,
      textoOk: 'Cambiar precios',
    })
    if (!ok) return
    setAplicando(true)
    const r = await pedir(false)
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
          Subí o bajá todos los precios de una vez, o dejalos en un precio fijo. Primero ves cómo
          quedan y después confirmás.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void aplicar()
          }}
        >
          <div className="ajuste-modos" role="radiogroup" aria-label="Tipo de ajuste">
            {MODOS.map((m) => (
              <button
                key={m.valor}
                type="button"
                role="radio"
                aria-checked={modo === m.valor}
                className={`ajuste-modo${modo === m.valor ? ' ajuste-modo--activo' : ''}`}
                onClick={() => setModo(m.valor)}
                disabled={aplicando}
              >
                {m.texto}
              </button>
            ))}
          </div>

          {modo === 'precio' ? (
            <div className="field">
              <label htmlFor="ajuste-precio">Precio nuevo ($)</label>
              <input
                id="ajuste-precio"
                type="text"
                inputMode="decimal"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                placeholder="Ej: 5000"
                autoComplete="off"
              />
            </div>
          ) : (
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
          )}

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
              {modo === 'precio'
                ? 'Todos esos productos ya tienen ese precio.'
                : 'Con ese ajuste no cambia ningún precio. Si redondeás a un monto grande, los precios que se moverían al revés (o quedarían en $0) se dejan igual.'}
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
