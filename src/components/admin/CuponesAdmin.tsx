import { useCallback, useEffect, useState } from 'react'
import type { Cupon, TipoCupon } from '../../types'
import { useDialog } from '../../context/DialogContext'
import { money } from '../../lib/format'
import {
  TEXTO_ESTADO_CUPON,
  aNumero,
  activarCupon,
  borrarCupon,
  describirCupon,
  estadoCupon,
  guardarCupon,
  listarCupones,
  normalizarCodigo,
  validarDatosCupon,
  type CuponConUsos,
  type DatosCupon,
} from '../../lib/cupones'
import { useCerrarConAtras } from '../../hooks/useCerrarConAtras'

// ---- Fechas del formulario ------------------------------------------------------
// El input date trabaja con "AAAA-MM-DD" en hora local; la base guarda
// timestamptz. "Desde" arranca a las 00:00 y "hasta" termina a las 23:59:59
// del día elegido (hora de Argentina, la del navegador de la admin).

function aFechaInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function deFechaInput(valor: string, finDelDia: boolean): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor)
  if (!m) return null
  const d = finDelDia
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999)
    : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toISOString()
}

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function textoVigencia(c: Cupon): string {
  if (c.desde && c.hasta) return `Del ${fechaCorta(c.desde)} al ${fechaCorta(c.hasta)}`
  if (c.hasta) return `Hasta el ${fechaCorta(c.hasta)}`
  if (c.desde) return `Desde el ${fechaCorta(c.desde)}`
  return 'Sin vencimiento'
}

// Entero opcional: vacío = null (ilimitado).
function enteroOpcional(valor: string): number | null {
  if (valor.trim() === '') return null
  const n = Number(valor)
  return Number.isFinite(n) ? n : NaN
}

interface Formulario {
  codigo: string
  descripcion: string
  tipo: TipoCupon
  valor: string
  minimo: string
  desde: string
  hasta: string
  usosMax: string
  usosPorCliente: string
  soloPrimeraCompra: boolean
  activo: boolean
  visibleEnCuenta: boolean
}

const FORM_VACIO: Formulario = {
  codigo: '',
  descripcion: '',
  tipo: 'porcentaje',
  valor: '',
  minimo: '',
  desde: '',
  hasta: '',
  usosMax: '',
  usosPorCliente: '1',
  soloPrimeraCompra: false,
  activo: true,
  visibleEnCuenta: false,
}

function formDe(c: Cupon): Formulario {
  const minimo = aNumero(c.minimo_compra)
  return {
    codigo: c.codigo,
    descripcion: c.descripcion ?? '',
    tipo: c.tipo,
    valor: c.tipo === 'envio_gratis' ? '' : String(aNumero(c.valor)),
    minimo: minimo > 0 ? String(minimo) : '',
    desde: aFechaInput(c.desde),
    hasta: aFechaInput(c.hasta),
    usosMax: c.usos_max === null ? '' : String(c.usos_max),
    usosPorCliente: c.usos_por_cliente === null ? '' : String(c.usos_por_cliente),
    soloPrimeraCompra: c.solo_primera_compra,
    activo: c.activo,
    visibleEnCuenta: c.visible_en_cuenta === true,
  }
}

function datosDe(f: Formulario): DatosCupon {
  return {
    codigo: normalizarCodigo(f.codigo),
    descripcion: f.descripcion.trim() || null,
    tipo: f.tipo,
    valor: f.tipo === 'envio_gratis' ? 0 : f.valor.trim() === '' ? NaN : Number(f.valor),
    minimo_compra: f.minimo.trim() === '' ? 0 : Number(f.minimo),
    desde: deFechaInput(f.desde, false),
    hasta: deFechaInput(f.hasta, true),
    usos_max: enteroOpcional(f.usosMax),
    usos_por_cliente: enteroOpcional(f.usosPorCliente),
    solo_primera_compra: f.soloPrimeraCompra,
    activo: f.activo,
    visible_en_cuenta: f.visibleEnCuenta,
  }
}

type Carga =
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje: string; faltaMigracion: boolean }
  | { estado: 'listo'; cupones: CuponConUsos[] }

// ABM de cupones de descuento (pestaña Ajustes del panel).
export default function CuponesAdmin() {
  const { confirmar, avisar } = useDialog()
  const [carga, setCarga] = useState<Carga>({ estado: 'cargando' })
  const [reintentando, setReintentando] = useState(false)

  const [hojaAbierta, setHojaAbierta] = useState(false)
  const [editando, setEditando] = useState<CuponConUsos | null>(null)
  const [form, setForm] = useState<Formulario>(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)
  const [errorForm, setErrorForm] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const r = await listarCupones()
    setCarga(
      r.ok
        ? { estado: 'listo', cupones: r.datos }
        : { estado: 'error', mensaje: r.mensaje, faltaMigracion: r.faltaMigracion },
    )
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function reintentar() {
    setReintentando(true)
    await cargar()
    setReintentando(false)
  }

  function abrirNuevo() {
    setEditando(null)
    setForm(FORM_VACIO)
    setErrorForm(null)
    setHojaAbierta(true)
  }

  function abrirEdicion(c: CuponConUsos) {
    setEditando(c)
    setForm(formDe(c))
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
    const problema = validarDatosCupon(datos)
    if (problema) {
      setErrorForm(problema)
      return
    }
    setGuardando(true)
    const error = await guardarCupon(datos, editando?.id)
    setGuardando(false)
    if (error) {
      setErrorForm(error)
      return
    }
    setHojaAbierta(false)
    cargar()
  }

  async function alternarActivo(c: CuponConUsos) {
    const error = await activarCupon(c.id, !c.activo)
    if (error) await avisar({ titulo: 'No se pudo actualizar el cupón', mensaje: error })
    else cargar()
  }

  async function borrar(c: CuponConUsos) {
    const ok = await confirmar({
      titulo: `¿Borrar el cupón ${c.codigo}?`,
      mensaje:
        c.usos > 0
          ? `Ya se usó ${c.usos} ${c.usos === 1 ? 'vez' : 'veces'}: si lo borrás se pierde ese registro. Para que no se use más, podés pausarlo.`
          : 'No se puede deshacer.',
      textoOk: 'Borrar',
      peligro: true,
    })
    if (!ok) return
    const error = await borrarCupon(c.id)
    if (error) {
      await avisar({ titulo: 'No se pudo borrar el cupón', mensaje: error })
      return
    }
    setHojaAbierta(false)
    cargar()
  }

  const ahora = Date.now()

  // "Atrás" en el celular cierra la hoja en vez de salir del panel.
  useCerrarConAtras(hojaAbierta, () => setHojaAbierta(false))

  return (
    <>
      <div className="ajustes-subhead">
        <p>Códigos de descuento para el checkout. La base valida cada uso.</p>
        {carga.estado === 'listo' && (
          <button type="button" className="head-action" onClick={abrirNuevo}>
            + Nuevo cupón
          </button>
        )}
      </div>

      <div className="list list--ajustes">
        {carga.estado === 'cargando' ? (
          <div className="empty">Cargando cupones…</div>
        ) : carga.estado === 'error' ? (
          <>
            <div className="empty" role="alert">
              {carga.faltaMigracion ? carga.mensaje : `No pudimos cargar los cupones. ${carga.mensaje}`}
            </div>
            {!carga.faltaMigracion && (
              <button className="orders-mas" onClick={reintentar} disabled={reintentando}>
                {reintentando ? 'Reintentando…' : 'Reintentar'}
              </button>
            )}
          </>
        ) : carga.cupones.length === 0 ? (
          <div className="empty">Todavía no creaste cupones.</div>
        ) : (
          carga.cupones.map((c) => {
            const estado = estadoCupon(c, c.usos, ahora)
            const minimo = aNumero(c.minimo_compra)
            return (
              <div className={`ajuste-card${c.activo ? '' : ' ajuste-card--off'}`} key={c.id}>
                <div className="ajuste-top">
                  <span className="ajuste-titulo ajuste-codigo">{c.codigo}</span>
                  <span className={`ajuste-estado ajuste-estado--${estado}`}>
                    {TEXTO_ESTADO_CUPON[estado]}
                  </span>
                </div>
                <div className="ajuste-valor">
                  {describirCupon(c)}
                  {minimo > 0 && <span className="ajuste-meta"> · compra mínima {money(minimo)}</span>}
                </div>
                {c.descripcion && <p className="ajuste-desc">{c.descripcion}</p>}
                <ul className="ajuste-datos">
                  <li>
                    {c.usos} {c.usos === 1 ? 'uso' : 'usos'}
                    {c.usos_max !== null ? ` de ${c.usos_max}` : ''}
                  </li>
                  <li>{textoVigencia(c)}</li>
                  <li>
                    {c.usos_por_cliente === null
                      ? 'Sin límite por clienta'
                      : `${c.usos_por_cliente} por clienta`}
                  </li>
                  {c.solo_primera_compra && <li>Solo primera compra</li>}
                  {c.visible_en_cuenta && <li>Visible en Mi cuenta</li>}
                </ul>
                <div className="ajuste-acciones">
                  <button type="button" className="ajuste-btn" onClick={() => abrirEdicion(c)}>
                    Editar
                  </button>
                  <button type="button" className="ajuste-btn" onClick={() => alternarActivo(c)}>
                    {c.activo ? 'Pausar' : 'Activar'}
                  </button>
                  <button
                    type="button"
                    className="ajuste-btn ajuste-btn--peligro"
                    onClick={() => borrar(c)}
                  >
                    Borrar
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Alta / edición: bottom sheet en el teléfono, modal centrado en desktop. */}
      <div
        className={hojaAbierta ? 'overlay open' : 'overlay'}
        onClick={(e) => {
          if (e.target === e.currentTarget) setHojaAbierta(false)
        }}
      >
        <div className="sheet sheet--ajustes" role="dialog" aria-modal="true" aria-labelledby="cupon-form-titulo">
          <div className="handle" />
          <h2 id="cupon-form-titulo">{editando ? `Editar ${editando.codigo}` : 'Nuevo cupón'}</h2>
          <form onSubmit={onGuardar} className="ajustes-form" noValidate>
            <div className="field">
              <label htmlFor="cupon-codigo">Código</label>
              <input
                id="cupon-codigo"
                type="text"
                value={form.codigo}
                onChange={(e) => cambiar('codigo', e.target.value.toUpperCase())}
                placeholder="Ej: VERANO10"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={40}
              />
            </div>
            <div className="field">
              <label htmlFor="cupon-descripcion">Descripción (opcional, uso interno)</label>
              <input
                id="cupon-descripcion"
                type="text"
                value={form.descripcion}
                onChange={(e) => cambiar('descripcion', e.target.value)}
                placeholder="Ej: Campaña de verano en Instagram"
              />
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="cupon-tipo">Tipo</label>
                <select
                  id="cupon-tipo"
                  value={form.tipo}
                  onChange={(e) => cambiar('tipo', e.target.value as TipoCupon)}
                >
                  <option value="porcentaje">Porcentaje</option>
                  <option value="monto">Monto fijo</option>
                  <option value="envio_gratis">Envío gratis</option>
                </select>
              </div>
              {form.tipo !== 'envio_gratis' && (
                <div className="field">
                  <label htmlFor="cupon-valor">{form.tipo === 'porcentaje' ? 'Descuento (%)' : 'Descuento ($)'}</label>
                  <input
                    id="cupon-valor"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={form.tipo === 'porcentaje' ? 100 : undefined}
                    step="any"
                    value={form.valor}
                    onChange={(e) => cambiar('valor', e.target.value)}
                    placeholder={form.tipo === 'porcentaje' ? '10' : '1500'}
                  />
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="cupon-minimo">Compra mínima ($, opcional)</label>
              <input
                id="cupon-minimo"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={form.minimo}
                onChange={(e) => cambiar('minimo', e.target.value)}
                placeholder="Sin mínimo"
              />
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="cupon-desde">Desde (opcional)</label>
                <input id="cupon-desde" type="date" value={form.desde} onChange={(e) => cambiar('desde', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="cupon-hasta">Hasta (opcional)</label>
                <input id="cupon-hasta" type="date" value={form.hasta} onChange={(e) => cambiar('hasta', e.target.value)} />
              </div>
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="cupon-usos-max">Usos máximos</label>
                <input
                  id="cupon-usos-max"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={form.usosMax}
                  onChange={(e) => cambiar('usosMax', e.target.value)}
                  placeholder="Ilimitado"
                />
              </div>
              <div className="field">
                <label htmlFor="cupon-usos-cliente">Usos por clienta</label>
                <input
                  id="cupon-usos-cliente"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={form.usosPorCliente}
                  onChange={(e) => cambiar('usosPorCliente', e.target.value)}
                  placeholder="Ilimitado"
                />
              </div>
            </div>
            <label className="ajuste-check">
              <input
                type="checkbox"
                checked={form.soloPrimeraCompra}
                onChange={(e) => cambiar('soloPrimeraCompra', e.target.checked)}
              />
              Solo para la primera compra de la clienta
            </label>
            <label className="ajuste-check">
              <input
                type="checkbox"
                checked={form.visibleEnCuenta}
                onChange={(e) => cambiar('visibleEnCuenta', e.target.checked)}
              />
              Mostrarlo en "Mi cuenta" de las clientas (si no, solo lo usa quien conoce el código)
            </label>
            <label className="ajuste-check">
              <input type="checkbox" checked={form.activo} onChange={(e) => cambiar('activo', e.target.checked)} />
              Activo (se puede usar en el checkout)
            </label>

            {errorForm && (
              <p className="form-error" role="alert">
                {errorForm}
              </p>
            )}

            {editando && (
              <button type="button" className="btn-danger-text sheet-peligro" onClick={() => borrar(editando)}>
                Borrar cupón
              </button>
            )}
            <div className="sheet-actions">
              <button type="submit" className="btn btn-primary" disabled={guardando}>
                {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear cupón'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setHojaAbierta(false)}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
