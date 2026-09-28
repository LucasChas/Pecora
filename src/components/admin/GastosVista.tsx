import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDialog } from '../../context/DialogContext'
import { money } from '../../lib/format'
import { fechaISO, type Rango } from '../../lib/estadisticas'
import {
  CATEGORIAS_GASTO,
  LARGO_MAX_CONCEPTO,
  LARGO_MAX_NOTAS,
  borrarGasto,
  costoPorUnidad,
  etiquetaCategoria,
  guardarGasto,
  listarGastos,
  listarProductosParaGastos,
  totalGastos,
  validarDatosGasto,
  type CategoriaGasto,
  type DatosGasto,
  type Gasto,
  type ProductoOpcion,
} from '../../lib/gastos'

// Vista "Gastos" de Estadísticas: compras de materiales, packaging, envíos y
// otros, filtradas por el período elegido. Alta / edición en el mismo bottom
// sheet que usa Ajustes (clases de admin.css).

type Carga =
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje: string; faltaMigracion: boolean }
  | { estado: 'listo'; gastos: Gasto[] }

interface Formulario {
  fecha: string
  concepto: string
  categoria: CategoriaGasto
  monto: string
  productoId: string
  cantidad: string
  notas: string
}

function formVacio(): Formulario {
  return {
    fecha: fechaISO(new Date()),
    concepto: '',
    categoria: 'materiales',
    monto: '',
    productoId: '',
    cantidad: '',
    notas: '',
  }
}

function formDe(g: Gasto): Formulario {
  return {
    fecha: g.fecha,
    concepto: g.concepto,
    categoria: g.categoria,
    monto: String(g.monto),
    productoId: g.producto_id ?? '',
    cantidad: g.cantidad === null ? '' : String(g.cantidad),
    notas: g.notas ?? '',
  }
}

// Acepta "1500", "1500.50" y "1500,50" (teclado del celular en español).
function aMonto(valor: string): number {
  const limpio = valor.trim().replace(',', '.')
  return limpio === '' ? NaN : Number(limpio)
}

function datosDe(f: Formulario): DatosGasto {
  return {
    fecha: f.fecha,
    concepto: f.concepto,
    categoria: f.categoria,
    monto: aMonto(f.monto),
    producto_id: f.productoId || null,
    cantidad: f.productoId && f.cantidad.trim() !== '' ? Number(f.cantidad) : null,
    notas: f.notas.trim() || null,
  }
}

function fechaCorta(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export default function GastosVista({ rango }: { rango: Rango }) {
  const { confirmar, avisar } = useDialog()
  const [carga, setCarga] = useState<Carga>({ estado: 'cargando' })
  const [productos, setProductos] = useState<ProductoOpcion[]>([])
  const [aviso, setAviso] = useState<string | null>(null)

  const [hojaAbierta, setHojaAbierta] = useState(false)
  const [editando, setEditando] = useState<Gasto | null>(null)
  const [form, setForm] = useState<Formulario>(formVacio)
  const [guardando, setGuardando] = useState(false)
  const [errorForm, setErrorForm] = useState<string | null>(null)
  const pedidoRef = useRef(0)

  const cargar = useCallback(async (r: Rango) => {
    const pedido = ++pedidoRef.current
    const res = await listarGastos(r)
    if (pedido !== pedidoRef.current) return
    setCarga(
      res.ok
        ? { estado: 'listo', gastos: res.datos }
        : { estado: 'error', mensaje: res.mensaje, faltaMigracion: res.faltaMigracion },
    )
  }, [])

  useEffect(() => {
    setCarga({ estado: 'cargando' })
    setAviso(null)
    void cargar({ desde: rango.desde, hasta: rango.hasta })
  }, [rango.desde, rango.hasta, cargar])

  useEffect(() => {
    let vivo = true
    void listarProductosParaGastos().then((p) => {
      if (vivo) setProductos(p)
    })
    return () => {
      vivo = false
      pedidoRef.current++
    }
  }, [])

  const total = useMemo(() => (carga.estado === 'listo' ? totalGastos(carga.gastos) : 0), [carga])

  function abrirNuevo() {
    setEditando(null)
    setForm(formVacio())
    setErrorForm(null)
    setHojaAbierta(true)
  }

  function abrirEdicion(g: Gasto) {
    setEditando(g)
    setForm(formDe(g))
    setErrorForm(null)
    setHojaAbierta(true)
  }

  function cambiar<K extends keyof Formulario>(campo: K, valor: Formulario[K]) {
    setForm((f) => ({ ...f, [campo]: valor }))
    setErrorForm(null)
  }

  async function onGuardar(e: React.FormEvent) {
    e.preventDefault()
    const datos = datosDe(form)
    const problema = validarDatosGasto(datos)
    if (problema) {
      setErrorForm(problema)
      return
    }
    setGuardando(true)
    const error = await guardarGasto(datos, editando?.id)
    setGuardando(false)
    if (error) {
      setErrorForm(error)
      return
    }
    setHojaAbierta(false)
    // Si la fecha queda fuera del período, el gasto no aparece en la lista:
    // se avisa para que no parezca que no se guardó.
    setAviso(
      datos.fecha < rango.desde || datos.fecha > rango.hasta
        ? `Gasto guardado. Su fecha (${fechaCorta(datos.fecha)}) queda fuera del período elegido.`
        : null,
    )
    void cargar(rango)
  }

  async function borrar(g: Gasto) {
    const ok = await confirmar({
      titulo: `¿Borrar “${g.concepto}”?`,
      mensaje: `${money(g.monto)} del ${fechaCorta(g.fecha)}. No se puede deshacer.`,
      textoOk: 'Borrar',
      peligro: true,
    })
    if (!ok) return
    const error = await borrarGasto(g.id)
    if (error) {
      await avisar({ titulo: 'No se pudo borrar el gasto', mensaje: error })
      return
    }
    setHojaAbierta(false)
    setAviso(null)
    void cargar(rango)
  }

  const datosForm = datosDe(form)
  const porUnidad = costoPorUnidad(datosForm.monto, datosForm.cantidad)
  const productoInexistente =
    form.productoId !== '' && productos.length > 0 && !productos.some((p) => p.id === form.productoId)

  return (
    <div className="est-gastos">
      <div className="est-gastos-head">
        <div>
          <p className="est-gastos-total">
            {carga.estado === 'listo' ? money(total) : '—'}
            <span>
              {carga.estado === 'listo'
                ? ` en ${carga.gastos.length} ${carga.gastos.length === 1 ? 'gasto' : 'gastos'}`
                : ''}
            </span>
          </p>
          <p className="est-gastos-ayuda">
            Registrá lo que comprás. Si es para un producto, indicá para cuántas unidades alcanza y
            vas a ver su costo y su ganancia estimada en “Rentabilidad”.
          </p>
        </div>
        {carga.estado !== 'error' && (
          <button type="button" className="est-btn" onClick={abrirNuevo}>
            + Nuevo gasto
          </button>
        )}
      </div>

      {aviso && (
        <p className="est-aviso" role="status">
          {aviso}
        </p>
      )}

      {carga.estado === 'cargando' ? (
        <div className="est-cargando" role="status" aria-live="polite">
          <span className="est-spinner" aria-hidden="true" />
          Cargando gastos…
        </div>
      ) : carga.estado === 'error' ? (
        <div className="est-error" role="alert">
          <p>{carga.mensaje}</p>
          {!carga.faltaMigracion && (
            <button type="button" className="est-btn" onClick={() => void cargar(rango)}>
              Reintentar
            </button>
          )}
        </div>
      ) : carga.gastos.length === 0 ? (
        <p className="est-vacio">No hay gastos cargados en este período.</p>
      ) : (
        <ul className="est-gastos-lista">
          {carga.gastos.map((g) => {
            const unidad = costoPorUnidad(g.monto, g.cantidad)
            return (
              <li className="est-gasto" key={g.id}>
                <div className="est-gasto-top">
                  <span className="est-gasto-concepto">{g.concepto}</span>
                  <span className="est-gasto-monto">{money(g.monto)}</span>
                </div>
                <div className="est-gasto-meta">
                  <span>{fechaCorta(g.fecha)}</span>
                  <span className={`est-chip est-chip--${g.categoria}`}>{etiquetaCategoria(g.categoria)}</span>
                  <span>
                    {g.producto_id
                      ? (g.producto_nombre ?? 'Producto')
                      : 'General'}
                    {g.cantidad !== null && unidad !== null
                      ? ` · ${g.cantidad} u. (${money(unidad)} c/u)`
                      : ''}
                  </span>
                </div>
                {g.notas && <p className="est-gasto-notas">{g.notas}</p>}
                <div className="est-gasto-acciones">
                  <button type="button" className="est-btn-sec" onClick={() => abrirEdicion(g)}>
                    Editar
                  </button>
                  <button type="button" className="est-btn-sec est-btn-sec--peligro" onClick={() => void borrar(g)}>
                    Borrar
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Alta / edición: bottom sheet en el teléfono, modal centrado en desktop. */}
      <div
        className={hojaAbierta ? 'overlay open' : 'overlay'}
        onClick={(e) => {
          if (e.target === e.currentTarget) setHojaAbierta(false)
        }}
      >
        <div className="sheet sheet--ajustes" role="dialog" aria-modal="true" aria-labelledby="gasto-form-titulo">
          <div className="handle" />
          <h2 id="gasto-form-titulo">{editando ? 'Editar gasto' : 'Nuevo gasto'}</h2>
          <form onSubmit={onGuardar} className="ajustes-form" noValidate>
            <div className="field">
              <label htmlFor="gasto-concepto">¿Qué compraste?</label>
              <input
                id="gasto-concepto"
                type="text"
                value={form.concepto}
                onChange={(e) => cambiar('concepto', e.target.value)}
                placeholder="Ej: Muselina doble gasa, 10 m"
                maxLength={LARGO_MAX_CONCEPTO}
                autoComplete="off"
              />
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="gasto-monto">Monto ($)</label>
                <input
                  id="gasto-monto"
                  type="text"
                  inputMode="decimal"
                  value={form.monto}
                  onChange={(e) => cambiar('monto', e.target.value)}
                  placeholder="0"
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="gasto-fecha">Fecha</label>
                <input
                  id="gasto-fecha"
                  type="date"
                  value={form.fecha}
                  max={fechaISO(new Date())}
                  onChange={(e) => cambiar('fecha', e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="gasto-categoria">Categoría</label>
              <select
                id="gasto-categoria"
                value={form.categoria}
                onChange={(e) => cambiar('categoria', e.target.value as CategoriaGasto)}
              >
                {CATEGORIAS_GASTO.map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {c.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="gasto-producto">Producto (opcional)</label>
              <select
                id="gasto-producto"
                value={form.productoId}
                onChange={(e) => {
                  const id = e.target.value
                  setForm((f) => ({ ...f, productoId: id, cantidad: id ? f.cantidad : '' }))
                  setErrorForm(null)
                }}
              >
                <option value="">Ninguno (gasto general)</option>
                {productoInexistente && editando && (
                  <option value={form.productoId}>{editando.producto_nombre ?? 'Producto actual'}</option>
                )}
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
            {form.productoId && (
              <div className="field">
                <label htmlFor="gasto-cantidad">¿Para cuántas unidades alcanza? (opcional)</label>
                <input
                  id="gasto-cantidad"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={form.cantidad}
                  onChange={(e) => cambiar('cantidad', e.target.value)}
                  placeholder="Ej: 10"
                />
                <p className="est-campo-ayuda" aria-live="polite">
                  {porUnidad !== null
                    ? `≈ ${money(porUnidad)} por unidad`
                    : 'Con la cantidad se estima el costo de cada unidad.'}
                </p>
              </div>
            )}
            <div className="field">
              <label htmlFor="gasto-notas">Notas (opcional)</label>
              <textarea
                id="gasto-notas"
                rows={2}
                value={form.notas}
                maxLength={LARGO_MAX_NOTAS}
                onChange={(e) => cambiar('notas', e.target.value)}
                placeholder="Ej: proveedor, color, número de factura"
              />
            </div>

            {errorForm && (
              <p className="form-error" role="alert">
                {errorForm}
              </p>
            )}

            <div className="sheet-actions">
              <button type="submit" className="btn btn-primary" disabled={guardando}>
                {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Agregar gasto'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setHojaAbierta(false)}>
                Cancelar
              </button>
              {editando && (
                <button type="button" className="btn-danger-text" onClick={() => void borrar(editando)}>
                  Borrar gasto
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
