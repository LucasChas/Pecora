import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import HeaderActions from '../components/account/HeaderActions'
import CalificarProducto from '../components/account/CalificarProducto'
import { Estrellas } from '../components/catalog/ResenasProducto'
import { useAuth } from '../context/AuthContext'
import { useDialog } from '../context/DialogContext'
import { useTitulo } from '../hooks/useTitulo'
import { invalidarResumenesResenas } from '../hooks/useResumenesResenas'
import { supabase } from '../lib/supabaseClient'
import { IMG_PLACEHOLDER, portadaDe } from '../lib/images'
import { cancelarAviso } from '../lib/avisos'
import { borrarResena, cargarMisResenas, formatearFechaResena, textoEstrellas, type MiResenaDeProducto } from '../lib/resenas'
import {
  MIN_PASSWORD,
  cambiarEmail,
  cambiarPassword,
  cargarMisAvisos,
  eliminarMiCuenta,
  guardarMisDatos,
  guardarPreferencias,
  type Preferencias as CambiosPreferencias,
  type MiAviso,
} from '../lib/miCuenta'
import { cargarCuponesDisponibles, textoBeneficio, type CuponDisponible } from '../lib/cupones'
import { money } from '../lib/format'
import { useFavoritos } from '../context/FavoritosContext'
import { cargarProductosPorId } from '../lib/pedidoCliente'
import { PROVINCIAS_AR } from '../lib/orders'
import {
  MAX_DIRECCIONES,
  borrarDireccion,
  cargarDirecciones,
  guardarDireccion,
  type DatosDireccion,
  type Direccion,
} from '../lib/direcciones'
import type { ProductoConCategoria } from '../types'
import '../styles/catalog.css'
import '../styles/cart.css'
import '../styles/account.css'
import '../styles/mi-cuenta.css'

interface ProductoResumen {
  nombre: string
  slug: string | null
  imagen: string
}

// "Mi cuenta" (/mi-cuenta): todo lo de la clienta logueada en un solo lugar.
// Cada sección carga y guarda por su cuenta: si una falla, las otras siguen.
export default function MiCuentaPage() {
  const { session, perfil, loading } = useAuth()
  useTitulo('Mi cuenta')

  if (loading) {
    return (
      <div className="catalog-root">
        <div className="loading-state">
          <span className="loading-spinner" aria-hidden="true" />
          Cargando…
        </div>
      </div>
    )
  }
  if (!session) return <Navigate to="/cuenta?next=/mi-cuenta" replace />

  const nombre = perfil?.nombre?.trim().split(/\s+/)[0]

  return (
    <div className="catalog-root">
      <header className="cart-header">
        <Link to="/">
          <Logo />
        </Link>
        <HeaderActions />
      </header>
      <Scallop />

      <main className="account mi-cuenta">
        <h1 className="cart-title">{nombre ? `Hola, ${nombre}` : 'Mi cuenta'}</h1>
        <p className="mc-sub">{session.user.email}</p>

        <nav className="mc-atajos" aria-label="Atajos de tu cuenta">
          <Link to="/mis-pedidos" className="mc-atajo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 8h12l-1 12H7L6 8z" />
              <path d="M9 8V6a3 3 0 0 1 6 0v2" />
            </svg>
            <span>Mis pedidos</span>
          </Link>
          <a href="#mc-favoritos" className="mc-atajo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20.5s-7.5-4.4-9.3-9.2C1.6 8.2 3.6 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.6 0 5.6 3.7 4.5 6.8-1.8 4.8-9.3 9.2-9.3 9.2z" />
            </svg>
            <span>Favoritos</span>
          </a>
          <a href="#mc-avisos" className="mc-atajo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            <span>Avisos de stock</span>
          </a>
          <a href="#mc-resenas" className="mc-atajo">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" />
            </svg>
            <span>Mis reseñas</span>
          </a>
        </nav>

        <MisCupones />
        <MisDatos />
        <MisFavoritos />
        <MisDirecciones />
        <MisAvisos />
        <MisResenas />
        <Seguridad />
        <Preferencias />
        <EliminarCuenta />
      </main>
    </div>
  )
}

// ---- Cupones disponibles -----------------------------------------------------------

function fechaCorta(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })
}

// Solo aparece si la tienda marcó algún cupón como visible y la clienta
// todavía lo puede usar (cupones_disponibles en la base).
function MisCupones() {
  const { notificar } = useDialog()
  const [cupones, setCupones] = useState<CuponDisponible[]>([])

  useEffect(() => {
    let vigente = true
    void cargarCuponesDisponibles().then((lista) => {
      if (vigente) setCupones(lista)
    })
    return () => {
      vigente = false
    }
  }, [])

  if (cupones.length === 0) return null

  async function copiar(codigo: string) {
    try {
      await navigator.clipboard.writeText(codigo)
      notificar(`Código ${codigo} copiado: pegalo en el checkout`)
    } catch {
      notificar(`Tu código es ${codigo}`)
    }
  }

  return (
    <section className="mc-seccion mc-seccion--cupones" aria-labelledby="mc-cupones-titulo">
      <h2 id="mc-cupones-titulo">Tus cupones</h2>
      <ul className="mc-cupones">
        {cupones.map((c) => (
          <li key={c.codigo} className="mc-cupon">
            <div>
              <p className="mc-cupon-beneficio">{textoBeneficio(c)}</p>
              {c.descripcion && <p className="mc-cupon-desc">{c.descripcion}</p>}
              <p className="mc-cupon-cond">
                {[
                  c.minimoCompra > 0 ? `Compra mínima ${money(c.minimoCompra)}` : null,
                  c.soloPrimeraCompra ? 'Para tu primera compra' : null,
                  c.hasta ? `Vence el ${fechaCorta(c.hasta)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <button type="button" className="mc-cupon-codigo" onClick={() => copiar(c.codigo)} aria-label={`Copiar el código ${c.codigo}`}>
              {c.codigo}
              <small>Copiar</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---- Mis datos -----------------------------------------------------------------

function MisDatos() {
  const { session, perfil, recargarPerfil } = useAuth()
  const { notificar } = useDialog()
  const [nombre, setNombre] = useState(perfil?.nombre ?? '')
  const [telefono, setTelefono] = useState(perfil?.telefono ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cuando llega el perfil (o cambia), se completan los campos.
  useEffect(() => {
    setNombre(perfil?.nombre ?? '')
    setTelefono(perfil?.telefono ?? '')
  }, [perfil?.nombre, perfil?.telefono])

  const cambios = nombre.trim() !== (perfil?.nombre ?? '').trim() || telefono.trim() !== (perfil?.telefono ?? '').trim()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session) return
    setGuardando(true)
    setError(null)
    const r = await guardarMisDatos(session.user.id, nombre, telefono)
    setGuardando(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    await recargarPerfil()
    notificar('Datos guardados')
  }

  return (
    <section className="mc-seccion" aria-labelledby="mc-datos-titulo">
      <h2 id="mc-datos-titulo">Mis datos</h2>
      <p className="mc-ayuda">Los usamos para completar tus compras y escribirte por WhatsApp.</p>
      <form className="account-form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="mc-nombre">Nombre y apellido</label>
          <input id="mc-nombre" type="text" maxLength={120} autoComplete="name" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="mc-telefono">Teléfono (WhatsApp, con código de área)</label>
          <input id="mc-telefono" type="tel" maxLength={40} autoComplete="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Ej: 351 555 1234" />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary mc-btn" disabled={guardando || !cambios}>
          {guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </form>
    </section>
  )
}

// ---- Favoritos ------------------------------------------------------------------------

function MisFavoritos() {
  const { ids, alternar } = useFavoritos()
  const [productos, setProductos] = useState<ProductoConCategoria[] | null>(null)
  const clave = ids ? [...ids].sort().join(',') : ''

  useEffect(() => {
    if (!ids) return
    let vigente = true
    void cargarProductosPorId([...ids]).then((lista) => {
      if (vigente) setProductos(lista)
    })
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  if (!ids) return null
  // Mismo orden que la lista de favoritos (los más nuevos primero).
  const orden = [...ids]
  const visibles = (productos ?? []).filter((p) => ids.has(p.id)).sort((a, b) => orden.indexOf(a.id) - orden.indexOf(b.id))

  return (
    <section className="mc-seccion" id="mc-favoritos" aria-labelledby="mc-favoritos-titulo">
      <h2 id="mc-favoritos-titulo">Favoritos</h2>
      {productos === null && ids.size > 0 ? (
        <p className="mc-vacio">Cargando…</p>
      ) : visibles.length === 0 ? (
        <p className="mc-vacio">Todavía no guardaste favoritos. Tocá el corazón de un producto para guardarlo acá.</p>
      ) : (
        <ul className="mc-lista">
          {visibles.map((p) => (
            <li key={p.id} className="mc-item">
              <Link to={`/producto/${p.slug ?? p.id}`} className="mc-item-prod">
                <img src={portadaDe(p) || IMG_PLACEHOLDER} alt="" />
                <span>
                  <strong>{p.nombre}</strong>
                  <small>
                    {money(p.precio)}
                    {p.stock > 0 ? '' : ' · Sin stock'}
                  </small>
                </span>
              </Link>
              <button type="button" className="mc-link" onClick={() => alternar(p.id)}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---- Direcciones ---------------------------------------------------------------------

const DIRECCION_VACIA: DatosDireccion = { alias: '', direccion: '', localidad: '', cp: '', provincia: '', principal: false }

function MisDirecciones() {
  const { confirmar, notificar } = useDialog()
  const [lista, setLista] = useState<Direccion[] | null>(null)
  const [editando, setEditando] = useState<{ id?: string; datos: DatosDireccion } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => setLista(await cargarDirecciones()), [])
  useEffect(() => {
    void cargar()
  }, [cargar])

  function cambiar<K extends keyof DatosDireccion>(campo: K, valor: DatosDireccion[K]) {
    setEditando((e) => (e ? { ...e, datos: { ...e.datos, [campo]: valor } } : e))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editando) return
    setGuardando(true)
    setError(null)
    const r = await guardarDireccion(editando.datos, editando.id)
    setGuardando(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setEditando(null)
    await cargar()
    notificar('Dirección guardada')
  }

  async function borrar(d: Direccion) {
    const ok = await confirmar({ titulo: `¿Borrar "${d.alias}"?`, textoOk: 'Borrar', peligro: true })
    if (!ok) return
    const r = await borrarDireccion(d.id)
    if (!r.ok) {
      notificar(r.error)
      return
    }
    await cargar()
  }

  return (
    <section className="mc-seccion" id="mc-direcciones" aria-labelledby="mc-direcciones-titulo">
      <h2 id="mc-direcciones-titulo">Mis direcciones</h2>
      <p className="mc-ayuda">Las elegís con un toque al comprar con envío a domicilio.</p>
      {lista === null ? (
        <p className="mc-vacio">Cargando…</p>
      ) : (
        <>
          {lista.length === 0 && !editando && <p className="mc-vacio">Todavía no guardaste direcciones.</p>}
          {lista.length > 0 && (
            <ul className="mc-lista">
              {lista.map((d) => (
                <li key={d.id} className="mc-item">
                  <div className="mc-dir">
                    <strong>
                      {d.alias}
                      {d.principal && <span className="mc-dir-principal">Principal</span>}
                    </strong>
                    <small>
                      {d.direccion}, {d.localidad}
                      {d.cp ? ` (CP ${d.cp})` : ''}
                      {d.provincia ? `, ${d.provincia}` : ''}
                    </small>
                  </div>
                  <div className="mc-acciones">
                    <button type="button" className="mc-link" onClick={() => { setError(null); setEditando({ id: d.id, datos: { ...d, cp: d.cp ?? '', provincia: d.provincia ?? '' } }) }}>
                      Editar
                    </button>
                    <button type="button" className="mc-link mc-link--peligro" onClick={() => borrar(d)}>
                      Borrar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {editando ? (
            <form className="account-form mc-subform mc-dir-form" onSubmit={onSubmit} noValidate>
              <div className="field">
                <label htmlFor="mc-dir-alias">Nombre (ej. Casa, Trabajo)</label>
                <input id="mc-dir-alias" maxLength={40} value={editando.datos.alias} onChange={(e) => cambiar('alias', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="mc-dir-direccion">Calle y número</label>
                <input id="mc-dir-direccion" maxLength={200} autoComplete="street-address" value={editando.datos.direccion} onChange={(e) => cambiar('direccion', e.target.value)} />
              </div>
              <div className="mc-fila">
                <div className="field">
                  <label htmlFor="mc-dir-localidad">Localidad</label>
                  <input id="mc-dir-localidad" maxLength={100} autoComplete="address-level2" value={editando.datos.localidad} onChange={(e) => cambiar('localidad', e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="mc-dir-cp">Código postal</label>
                  <input id="mc-dir-cp" maxLength={20} inputMode="numeric" autoComplete="postal-code" value={editando.datos.cp ?? ''} onChange={(e) => cambiar('cp', e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="mc-dir-provincia">Provincia</label>
                <select id="mc-dir-provincia" value={editando.datos.provincia ?? ''} onChange={(e) => cambiar('provincia', e.target.value)}>
                  <option value="">Elegí una provincia</option>
                  {PROVINCIAS_AR.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <label className="mc-check">
                <input type="checkbox" checked={editando.datos.principal} onChange={(e) => cambiar('principal', e.target.checked)} />
                <span>Usarla como principal</span>
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="mc-form-botones">
                <button type="submit" className="btn btn-primary mc-btn" disabled={guardando}>
                  {guardando ? 'Guardando…' : 'Guardar dirección'}
                </button>
                <button type="button" className="mc-link" onClick={() => setEditando(null)} disabled={guardando}>
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            lista.length < MAX_DIRECCIONES && (
              <button
                type="button"
                className="mc-agregar"
                onClick={() => {
                  setError(null)
                  setEditando({ datos: { ...DIRECCION_VACIA, principal: lista.length === 0 } })
                }}
              >
                + Agregar dirección
              </button>
            )
          )}
        </>
      )}
    </section>
  )
}

// ---- Avisos de stock --------------------------------------------------------------

function MisAvisos() {
  const { notificar } = useDialog()
  const [avisos, setAvisos] = useState<MiAviso[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelando, setCancelando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const r = await cargarMisAvisos()
    if (r.ok) setAvisos(r.valor)
    else setError(r.error)
  }, [])
  useEffect(() => {
    void cargar()
  }, [cargar])

  async function cancelar(a: MiAviso) {
    setCancelando(a.productoId)
    const r = await cancelarAviso(a.productoId)
    setCancelando(null)
    if (!r.ok) {
      notificar(r.error)
      return
    }
    setAvisos((lista) => (lista ?? []).filter((x) => x.productoId !== a.productoId))
    notificar('Aviso cancelado')
  }

  return (
    <section className="mc-seccion" id="mc-avisos" aria-labelledby="mc-avisos-titulo">
      <h2 id="mc-avisos-titulo">Avisos de stock</h2>
      <p className="mc-ayuda">Te mandamos un mail cuando estos productos vuelvan a tener stock.</p>
      {error ? (
        <p className="mc-vacio">{error}</p>
      ) : avisos === null ? (
        <p className="mc-vacio">Cargando…</p>
      ) : avisos.length === 0 ? (
        <p className="mc-vacio">
          No tenés avisos. En un producto sin stock tocá "Avisame cuando vuelva".
        </p>
      ) : (
        <ul className="mc-lista">
          {avisos.map((a) => (
            <li key={a.productoId} className="mc-item">
              <Link to={`/producto/${a.slug ?? a.productoId}`} className="mc-item-prod">
                <img src={a.imagen || IMG_PLACEHOLDER} alt="" />
                <span>
                  <strong>{a.nombre}</strong>
                  <small>{a.stock > 0 ? '¡Ya hay stock!' : 'Sin stock por ahora'}</small>
                </span>
              </Link>
              <button type="button" className="mc-link" onClick={() => cancelar(a)} disabled={cancelando === a.productoId}>
                {cancelando === a.productoId ? 'Cancelando…' : 'Cancelar'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---- Mis reseñas -----------------------------------------------------------------------

function MisResenas() {
  const { confirmar, notificar } = useDialog()
  const [resenas, setResenas] = useState<MiResenaDeProducto[] | null>(null)
  const [productos, setProductos] = useState<Record<string, ProductoResumen>>({})
  const [noDisponible, setNoDisponible] = useState(false)
  const [editando, setEditando] = useState<MiResenaDeProducto | null>(null)

  const cargar = useCallback(async () => {
    const r = await cargarMisResenas()
    if (!r.ok) {
      setNoDisponible(true)
      return
    }
    setResenas(r.valor)
    const ids = r.valor.map((x) => x.producto_id)
    if (ids.length === 0) return
    const { data } = await supabase.from('productos').select('id, nombre, slug, imagenes, imagen_url').in('id', ids)
    const mapa: Record<string, ProductoResumen> = {}
    for (const p of data ?? []) mapa[p.id] = { nombre: p.nombre, slug: p.slug, imagen: portadaDe(p) }
    setProductos(mapa)
  }, [])
  useEffect(() => {
    void cargar()
  }, [cargar])

  if (noDisponible) return null

  async function borrar(r: MiResenaDeProducto) {
    const ok = await confirmar({ titulo: '¿Borrar tu reseña?', textoOk: 'Borrar', peligro: true })
    if (!ok) return
    const res = await borrarResena(r.producto_id)
    if (!res.ok) {
      notificar(res.error)
      return
    }
    invalidarResumenesResenas()
    setResenas((lista) => (lista ?? []).filter((x) => x.id !== r.id))
    notificar('Reseña borrada')
  }

  return (
    <section className="mc-seccion" id="mc-resenas" aria-labelledby="mc-resenas-titulo">
      <h2 id="mc-resenas-titulo">Mis reseñas</h2>
      {resenas === null ? (
        <p className="mc-vacio">Cargando…</p>
      ) : resenas.length === 0 ? (
        <p className="mc-vacio">
          Todavía no dejaste reseñas. Podés calificar lo que compraste desde <Link to="/mis-pedidos">Mis pedidos</Link>.
        </p>
      ) : (
        <ul className="mc-lista">
          {resenas.map((r) => {
            const p = productos[r.producto_id]
            return (
              <li key={r.id} className="mc-item mc-item--resena">
                <div className="mc-item-prod">
                  <img src={p?.imagen ?? IMG_PLACEHOLDER} alt="" />
                  <span>
                    <strong>{p ? <Link to={`/producto/${p.slug ?? r.producto_id}`}>{p.nombre}</Link> : 'Producto'}</strong>
                    <Estrellas llenas={r.estrellas} etiqueta={textoEstrellas(r.estrellas)} />
                    {r.comentario && <q className="mc-comentario">{r.comentario}</q>}
                    <small>
                      {formatearFechaResena(r.updated_at || r.created_at)}
                      {r.oculta && ' · La tienda la ocultó'}
                    </small>
                  </span>
                </div>
                <div className="mc-acciones">
                  {p && (
                    <button type="button" className="mc-link" onClick={() => setEditando(r)}>
                      Editar
                    </button>
                  )}
                  <button type="button" className="mc-link mc-link--peligro" onClick={() => borrar(r)}>
                    Borrar
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {editando && productos[editando.producto_id] && (
        <CalificarProducto
          productoId={editando.producto_id}
          nombre={productos[editando.producto_id].nombre}
          imagen={productos[editando.producto_id].imagen}
          inicial={editando}
          onClose={() => setEditando(null)}
          onGuardada={() => {
            setEditando(null)
            invalidarResumenesResenas()
            void cargar()
            notificar('Reseña actualizada')
          }}
        />
      )}
    </section>
  )
}

// ---- Seguridad (contraseña y email) ------------------------------------------------------

function Seguridad() {
  const { session } = useAuth()
  const { notificar } = useDialog()
  const [abierto, setAbierto] = useState<'password' | 'email' | null>(null)
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [email, setEmail] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  function abrir(cual: 'password' | 'email') {
    setAbierto((a) => (a === cual ? null : cual))
    setError(null)
    setAviso(null)
  }

  async function onPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!session?.user.email) return
    setOcupado(true)
    setError(null)
    const r = await cambiarPassword(session.user.email, actual, nueva, repetida)
    setOcupado(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setActual('')
    setNueva('')
    setRepetida('')
    setAbierto(null)
    notificar('Contraseña cambiada')
  }

  async function onEmail(e: React.FormEvent) {
    e.preventDefault()
    setOcupado(true)
    setError(null)
    const r = await cambiarEmail(email, session?.user.email)
    setOcupado(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setEmail('')
    setAviso(
      `Te mandamos un mail a ${r.valor} para confirmar el cambio (puede llegar también uno a tu email actual). ` +
        'Hasta que lo confirmes seguís ingresando con el email de siempre.',
    )
  }

  return (
    <section className="mc-seccion" aria-labelledby="mc-seguridad-titulo">
      <h2 id="mc-seguridad-titulo">Seguridad</h2>
      <div className="mc-desplegables">
        <button type="button" className="mc-desplegable" aria-expanded={abierto === 'password'} onClick={() => abrir('password')}>
          Cambiar contraseña
          <span aria-hidden="true">{abierto === 'password' ? '−' : '+'}</span>
        </button>
        {abierto === 'password' && (
          <form className="account-form mc-subform" onSubmit={onPassword} noValidate>
            <div className="field">
              <label htmlFor="mc-pass-actual">Contraseña actual</label>
              <input id="mc-pass-actual" type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="mc-pass-nueva">Contraseña nueva (mínimo {MIN_PASSWORD} caracteres)</label>
              <input id="mc-pass-nueva" type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="mc-pass-repetida">Repetí la contraseña nueva</label>
              <input id="mc-pass-repetida" type="password" autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-primary mc-btn" disabled={ocupado}>
              {ocupado ? 'Cambiando…' : 'Cambiar contraseña'}
            </button>
          </form>
        )}

        <button type="button" className="mc-desplegable" aria-expanded={abierto === 'email'} onClick={() => abrir('email')}>
          Cambiar email
          <span aria-hidden="true">{abierto === 'email' ? '−' : '+'}</span>
        </button>
        {abierto === 'email' && (
          <form className="account-form mc-subform" onSubmit={onEmail} noValidate>
            <p className="mc-ayuda">Tu email actual: {session?.user.email}</p>
            <div className="field">
              <label htmlFor="mc-email-nuevo">Email nuevo</label>
              <input id="mc-email-nuevo" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {aviso && (
              <p className="mc-ok" role="status">
                {aviso}
              </p>
            )}
            <button type="submit" className="btn btn-primary mc-btn" disabled={ocupado}>
              {ocupado ? 'Enviando…' : 'Cambiar email'}
            </button>
          </form>
        )}
      </div>
    </section>
  )
}

// ---- Preferencias -----------------------------------------------------------------------------

function Preferencias() {
  const { session, perfil, recargarPerfil } = useAuth()
  const { notificar } = useDialog()
  const [guardando, setGuardando] = useState(false)
  const novedades = perfil?.acepta_novedades === true
  const carrito = perfil?.recordar_carrito !== false

  async function cambiar(cambios: CambiosPreferencias, aviso: string) {
    if (!session) return
    setGuardando(true)
    const r = await guardarPreferencias(session.user.id, cambios)
    setGuardando(false)
    if (!r.ok) {
      notificar(r.error)
      return
    }
    await recargarPerfil()
    notificar(aviso)
  }

  return (
    <section className="mc-seccion" aria-labelledby="mc-pref-titulo">
      <h2 id="mc-pref-titulo">Mails</h2>
      <label className="mc-check">
        <input
          type="checkbox"
          checked={novedades}
          disabled={guardando}
          onChange={(e) =>
            cambiar(
              { acepta_novedades: e.target.checked },
              e.target.checked ? 'Te vamos a avisar de las novedades' : 'Listo, no te mandamos novedades',
            )
          }
        />
        <span>
          Quiero recibir novedades y promociones por mail
          <small>Los mails de tus pedidos y de los avisos de stock te llegan igual.</small>
        </span>
      </label>
      <label className="mc-check">
        <input
          type="checkbox"
          checked={carrito}
          disabled={guardando}
          onChange={(e) =>
            cambiar(
              { recordar_carrito: e.target.checked },
              e.target.checked
                ? 'Te avisamos si dejás productos en el carrito'
                : 'Listo, no te recordamos el carrito',
            )
          }
        />
        <span>
          Recordarme si dejo productos en el carrito
          <small>Un solo mail, al día siguiente, si no terminaste la compra.</small>
        </span>
      </label>
    </section>
  )
}

// ---- Eliminar cuenta ---------------------------------------------------------------------------

function EliminarCuenta() {
  const { esAdmin, perfil } = useAuth()
  const { confirmar, notificar } = useDialog()
  const navigate = useNavigate()
  const [ocupado, setOcupado] = useState(false)

  // El equipo de la tienda no se da de baja desde acá.
  if (esAdmin || perfil?.rol === 'empleado') return null

  async function eliminar() {
    const ok = await confirmar({
      titulo: '¿Eliminar tu cuenta?',
      mensaje:
        'Se borran tus datos, tus reseñas y tus avisos de stock. Tus pedidos quedan registrados en la tienda, ' +
        'pero ya no vas a poder verlos desde una cuenta. No se puede deshacer.',
      textoOk: 'Eliminar mi cuenta',
      textoCancelar: 'Cancelar',
      peligro: true,
    })
    if (!ok) return
    setOcupado(true)
    const r = await eliminarMiCuenta()
    setOcupado(false)
    if (!r.ok) {
      notificar(r.error)
      return
    }
    notificar('Eliminamos tu cuenta')
    navigate('/', { replace: true })
  }

  return (
    <section className="mc-seccion mc-seccion--peligro" aria-labelledby="mc-baja-titulo">
      <h2 id="mc-baja-titulo">Eliminar cuenta</h2>
      <p className="mc-ayuda">Borra tus datos personales de la tienda. No se puede deshacer.</p>
      <button type="button" className="mc-btn-peligro" onClick={eliminar} disabled={ocupado}>
        {ocupado ? 'Eliminando…' : 'Eliminar mi cuenta'}
      </button>
    </section>
  )
}
