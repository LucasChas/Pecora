import { useCallback, useEffect, useState } from 'react'
import type { ZonaEnvio } from '../../types'
import { useDialog } from '../../context/DialogContext'
import { money } from '../../lib/format'
import { PROVINCIAS_AR } from '../../lib/orders'
import { aNumero } from '../../lib/cupones'
import {
  activarZona,
  borrarZona,
  describirCobertura,
  guardarOrden,
  guardarZona,
  listarZonas,
  parsearPrefijos,
  validarDatosZona,
  type DatosZona,
} from '../../lib/envios'

interface Formulario {
  nombre: string
  provincias: string[]
  prefijos: string
  precio: string
  gratisDesde: string
  activo: boolean
}

const FORM_VACIO: Formulario = {
  nombre: '',
  provincias: [],
  prefijos: '',
  precio: '',
  gratisDesde: '',
  activo: true,
}

function formDe(z: ZonaEnvio): Formulario {
  return {
    nombre: z.nombre,
    provincias: z.provincias ?? [],
    prefijos: (z.cp_prefijos ?? []).join(', '),
    precio: String(aNumero(z.precio)),
    gratisDesde: z.gratis_desde === null ? '' : String(aNumero(z.gratis_desde)),
    activo: z.activo,
  }
}

type Carga =
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje: string; faltaMigracion: boolean }
  | { estado: 'listo'; zonas: ZonaEnvio[] }

// ABM de zonas de envío (pestaña Ajustes del panel). El orden de la lista es
// el que usa cotizar_envio para elegir la zona cuando varias coinciden.
export default function ZonasEnvioAdmin() {
  const { confirmar, avisar } = useDialog()
  const [carga, setCarga] = useState<Carga>({ estado: 'cargando' })
  const [reintentando, setReintentando] = useState(false)
  const [moviendo, setMoviendo] = useState(false)

  const [hojaAbierta, setHojaAbierta] = useState(false)
  const [editando, setEditando] = useState<ZonaEnvio | null>(null)
  const [form, setForm] = useState<Formulario>(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)
  const [errorForm, setErrorForm] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const r = await listarZonas()
    setCarga(
      r.ok
        ? { estado: 'listo', zonas: r.datos }
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

  const zonas = carga.estado === 'listo' ? carga.zonas : []

  function abrirNuevo() {
    setEditando(null)
    setForm(FORM_VACIO)
    setErrorForm(null)
    setHojaAbierta(true)
  }

  function abrirEdicion(z: ZonaEnvio) {
    setEditando(z)
    setForm(formDe(z))
    setErrorForm(null)
    setHojaAbierta(true)
  }

  function cambiar<K extends keyof Formulario>(campo: K, valor: Formulario[K]) {
    setForm((f) => ({ ...f, [campo]: valor }))
    setErrorForm(null)
  }

  function alternarProvincia(p: string) {
    setForm((f) => ({
      ...f,
      provincias: f.provincias.includes(p) ? f.provincias.filter((x) => x !== p) : [...f.provincias, p],
    }))
    setErrorForm(null)
  }

  async function onGuardar(e: React.FormEvent) {
    e.preventDefault()
    const datos: DatosZona = {
      nombre: form.nombre.trim(),
      // En el orden de la lista oficial, para que se lea prolijo.
      provincias: PROVINCIAS_AR.filter((p) => form.provincias.includes(p)),
      cp_prefijos: parsearPrefijos(form.prefijos),
      precio: form.precio.trim() === '' ? NaN : Number(form.precio),
      gratis_desde: form.gratisDesde.trim() === '' ? null : Number(form.gratisDesde),
      activo: form.activo,
      // Una zona nueva va al final de la lista.
      orden: editando ? editando.orden : zonas.reduce((max, z) => Math.max(max, z.orden + 1), 0),
    }
    const problema = validarDatosZona(datos)
    if (problema) {
      setErrorForm(problema)
      return
    }
    setGuardando(true)
    const error = await guardarZona(datos, editando?.id)
    setGuardando(false)
    if (error) {
      setErrorForm(error)
      return
    }
    setHojaAbierta(false)
    cargar()
  }

  async function alternarActiva(z: ZonaEnvio) {
    const error = await activarZona(z.id, !z.activo)
    if (error) await avisar({ titulo: 'No se pudo actualizar la zona', mensaje: error })
    else cargar()
  }

  async function borrar(z: ZonaEnvio) {
    const ok = await confirmar({
      titulo: `¿Borrar la zona "${z.nombre}"?`,
      mensaje: 'Los pedidos ya hechos conservan su costo de envío. No se puede deshacer.',
      textoOk: 'Borrar',
      peligro: true,
    })
    if (!ok) return
    const error = await borrarZona(z.id)
    if (error) {
      await avisar({ titulo: 'No se pudo borrar la zona', mensaje: error })
      return
    }
    setHojaAbierta(false)
    cargar()
  }

  // Sube o baja una zona: se reordena en pantalla y se guarda 0..n-1.
  async function mover(indice: number, delta: -1 | 1) {
    const destino = indice + delta
    if (moviendo || destino < 0 || destino >= zonas.length) return
    const nuevas = [...zonas]
    ;[nuevas[indice], nuevas[destino]] = [nuevas[destino], nuevas[indice]]
    setCarga({ estado: 'listo', zonas: nuevas })
    setMoviendo(true)
    const error = await guardarOrden(nuevas)
    setMoviendo(false)
    if (error) await avisar({ titulo: 'No se pudo guardar el orden', mensaje: error })
    cargar()
  }

  return (
    <>
      <div className="ajustes-subhead">
        <p>
          Costo del envío a domicilio según provincia o código postal. Un prefijo de CP que
          coincida gana sobre la provincia; si varias zonas coinciden, se usa la primera de la
          lista.
        </p>
        {carga.estado === 'listo' && (
          <button type="button" className="head-action" onClick={abrirNuevo}>
            + Nueva zona
          </button>
        )}
      </div>

      <div className="list list--ajustes">
        {carga.estado === 'cargando' ? (
          <div className="empty">Cargando zonas…</div>
        ) : carga.estado === 'error' ? (
          <>
            <div className="empty" role="alert">
              {carga.faltaMigracion ? carga.mensaje : `No pudimos cargar las zonas. ${carga.mensaje}`}
            </div>
            {!carga.faltaMigracion && (
              <button className="orders-mas" onClick={reintentar} disabled={reintentando}>
                {reintentando ? 'Reintentando…' : 'Reintentar'}
              </button>
            )}
          </>
        ) : zonas.length === 0 ? (
          <div className="empty">
            Todavía no cargaste zonas: el envío se coordina por WhatsApp en todos los pedidos.
          </div>
        ) : (
          zonas.map((z, i) => {
            const gratisDesde = z.gratis_desde === null ? null : aNumero(z.gratis_desde)
            return (
              <div className={`ajuste-card${z.activo ? '' : ' ajuste-card--off'}`} key={z.id}>
                <div className="ajuste-top">
                  <span className="ajuste-titulo">
                    <span className="ajuste-orden">{i + 1}</span>
                    {z.nombre}
                  </span>
                  <span className={`ajuste-estado ajuste-estado--${z.activo ? 'activo' : 'inactivo'}`}>
                    {z.activo ? 'Activa' : 'Pausada'}
                  </span>
                </div>
                <div className="ajuste-valor">
                  {aNumero(z.precio) > 0 ? money(aNumero(z.precio)) : 'Gratis'}
                  {gratisDesde !== null && gratisDesde > 0 && (
                    <span className="ajuste-meta"> · gratis desde {money(gratisDesde)}</span>
                  )}
                </div>
                <p className="ajuste-desc">{describirCobertura(z)}</p>
                <div className="ajuste-acciones">
                  <button
                    type="button"
                    className="ajuste-btn ajuste-btn--icono"
                    onClick={() => mover(i, -1)}
                    disabled={i === 0 || moviendo}
                    aria-label={`Subir ${z.nombre}`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="ajuste-btn ajuste-btn--icono"
                    onClick={() => mover(i, 1)}
                    disabled={i === zonas.length - 1 || moviendo}
                    aria-label={`Bajar ${z.nombre}`}
                  >
                    ↓
                  </button>
                  <button type="button" className="ajuste-btn" onClick={() => abrirEdicion(z)}>
                    Editar
                  </button>
                  <button type="button" className="ajuste-btn" onClick={() => alternarActiva(z)}>
                    {z.activo ? 'Pausar' : 'Activar'}
                  </button>
                  <button
                    type="button"
                    className="ajuste-btn ajuste-btn--peligro"
                    onClick={() => borrar(z)}
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
        <div className="sheet sheet--ajustes" role="dialog" aria-modal="true" aria-labelledby="zona-form-titulo">
          <div className="handle" />
          <h2 id="zona-form-titulo">{editando ? `Editar ${editando.nombre}` : 'Nueva zona de envío'}</h2>
          <form onSubmit={onGuardar} className="ajustes-form" noValidate>
            <div className="field">
              <label htmlFor="zona-nombre">Nombre</label>
              <input
                id="zona-nombre"
                type="text"
                value={form.nombre}
                onChange={(e) => cambiar('nombre', e.target.value)}
                placeholder="Ej: AMBA, Córdoba Capital, Resto del país"
              />
            </div>

            <fieldset className="field ajuste-provincias">
              <legend>
                Provincias <span className="ajuste-contador">({form.provincias.length} elegidas)</span>
              </legend>
              <div className="ajuste-prov-grid">
                {PROVINCIAS_AR.map((p) => {
                  const elegida = form.provincias.includes(p)
                  return (
                    <label key={p} className={elegida ? 'ajuste-prov activa' : 'ajuste-prov'}>
                      <input type="checkbox" checked={elegida} onChange={() => alternarProvincia(p)} />
                      {p}
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <div className="field">
              <label htmlFor="zona-prefijos">Prefijos de código postal (opcional)</label>
              <input
                id="zona-prefijos"
                type="text"
                inputMode="numeric"
                value={form.prefijos}
                onChange={(e) => cambiar('prefijos', e.target.value)}
                placeholder="Ej: 5000, 5152, 50"
                aria-describedby="zona-prefijos-ayuda"
              />
              <p id="zona-prefijos-ayuda" className="ajuste-ayuda">
                Separados por coma. Un prefijo cubre todos los CP que empiezan así (ej. "50" cubre
                5000 a 5099).
              </p>
            </div>

            <div className="row2">
              <div className="field">
                <label htmlFor="zona-precio">Precio del envío ($)</label>
                <input
                  id="zona-precio"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={form.precio}
                  onChange={(e) => cambiar('precio', e.target.value)}
                  placeholder="3500"
                />
              </div>
              <div className="field">
                <label htmlFor="zona-gratis">Gratis desde ($)</label>
                <input
                  id="zona-gratis"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={form.gratisDesde}
                  onChange={(e) => cambiar('gratisDesde', e.target.value)}
                  placeholder="Nunca"
                />
              </div>
            </div>

            <label className="ajuste-check">
              <input type="checkbox" checked={form.activo} onChange={(e) => cambiar('activo', e.target.checked)} />
              Activa (se usa para cotizar en el checkout)
            </label>

            {errorForm && (
              <p className="form-error" role="alert">
                {errorForm}
              </p>
            )}

            <div className="sheet-actions">
              <button type="submit" className="btn btn-primary" disabled={guardando}>
                {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear zona'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setHojaAbierta(false)}>
                Cancelar
              </button>
              {editando && (
                <button type="button" className="btn-danger-text" onClick={() => borrar(editando)}>
                  Borrar zona
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
