import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useDialog } from '../context/DialogContext'
import { useProducts } from '../hooks/useProducts'
import { useCategories } from '../hooks/useCategories'
import { useOrders, type FiltroEstado } from '../hooks/useOrders'
import { useMiniaturasAutomaticas } from '../hooks/useMiniaturasAutomaticas'
import type { Pedido, ProductoConCategoria } from '../types'
import Logo from '../components/Logo'
import LoginForm from '../components/admin/LoginForm'
import StatsStrip from '../components/admin/StatsStrip'
import ProductList from '../components/admin/ProductList'
import SearchBar from '../components/common/SearchBar'
import CategoryFilters from '../components/common/CategoryFilters'
import ProductFormSheet from '../components/admin/ProductFormSheet'
import CategoryManagerSheet from '../components/admin/CategoryManagerSheet'
import ManualOrderSheet from '../components/admin/ManualOrderSheet'
import AjustarPreciosSheet from '../components/admin/AjustarPreciosSheet'
import OrdersList from '../components/admin/OrdersList'
import CatalogExport from '../components/admin/CatalogExport'
import AjustesPanel from '../components/admin/AjustesPanel'
import EstadisticasPanel from '../components/admin/EstadisticasPanel'
import { permisosDe } from '../lib/roles'
import { STOCK_BAJO } from '../lib/stock'
import { coincideBusqueda } from '../lib/format'
import '../styles/admin.css'
import { useTitulo } from '../hooks/useTitulo'

// 'exportar' = lista de precios para imprimir/PDF (pantalla completa, sin pestañas).
// 'ajustes' = cupones, zonas de envío, carga masiva y equipo (solo admin).
// 'estadisticas' = ventas y más vendidos (solo admin).
type Vista = 'productos' | 'pedidos' | 'estadisticas' | 'ajustes' | 'exportar'

// Chips de filtro de la pestaña Pedidos. El texto es el que usa la clienta en
// "Mis pedidos", para hablar el mismo idioma en las dos puntas.
const FILTROS: { valor: FiltroEstado; texto: string }[] = [
  { valor: 'todos', texto: 'Todos' },
  { valor: 'nuevo', texto: 'Nuevos' },
  { valor: 'confirmado', texto: 'En preparación' },
  { valor: 'enviado', texto: 'Enviados' },
  { valor: 'entregado', texto: 'Entregados' },
  { valor: 'cancelado', texto: 'Cancelados' },
  { valor: 'sin-pagar', texto: 'Sin pagar' },
  { valor: 'eliminados', texto: 'Papelera' },
]

// Vista ADMINISTRADORA (mobile-first), protegida por login. Entran admin y
// empleado; lo que ve cada uno sale de permisosDe (lib/roles).
export default function AdminPage() {
  const { session, perfil, loading: cargandoSesion } = useAuth()
  const permisos = permisosDe(perfil)
  useTitulo('Panel')
  const {
    productos,
    loading: cargandoProductos,
    error: errorProductos,
    refetch: refetchProductos,
  } = useProducts()
  const {
    categorias,
    loading: cargandoCategorias,
    error: errorCategorias,
    refetch: refetchCategorias,
  } = useCategories()
  const { confirmar, notificar } = useDialog()
  // La pestaña se recuerda en este dispositivo: al recargar o volver al panel
  // no vuelve siempre a Productos.
  const [vistaElegida, setVistaElegida] = useState<Vista>(() => {
    try {
      const guardada = localStorage.getItem('pecora-panel-vista')
      return guardada === 'pedidos' || guardada === 'estadisticas' || guardada === 'ajustes'
        ? guardada
        : 'productos'
    } catch {
      return 'productos'
    }
  })
  const setVista = useCallback((v: Vista) => {
    setVistaElegida(v)
    try {
      if (v !== 'exportar') localStorage.setItem('pecora-panel-vista', v)
    } catch {
      /* sin persistencia */
    }
  }, [])
  // Si el rol no alcanza para la vista elegida (ej. cambió el perfil), Productos.
  const vista: Vista =
    (vistaElegida === 'ajustes' && !permisos.ajustes) ||
    (vistaElegida === 'estadisticas' && !permisos.estadisticas)
      ? 'productos'
      : vistaElegida

  // Miniaturas que falten (fotos viejas): se generan solas, solo con la admin
  // logueada y fuera de "Exportar catálogo" (que ya procesa sus propias
  // fotos). Nada en pantalla mientras funcione; si viene fallando varias
  // pasadas seguidas, una sola línea discreta en Productos.
  const { necesitaAtencion: miniaturasConProblemas } = useMiniaturasAutomaticas(
    productos,
    Boolean(session) && permisos.panel && vista !== 'exportar',
  )

  // Reintento de la carga de productos cuando falla la red.
  const [reintentando, setReintentando] = useState(false)
  const reintentarProductos = useCallback(async () => {
    setReintentando(true)
    await refetchProductos()
    setReintentando(false)
  }, [refetchProductos])

  // Filtro y búsqueda de la pestaña Pedidos (la consulta se hace en la base).
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todos')
  const [busqueda, setBusqueda] = useState('')

  // Búsqueda y filtros de la pestaña Productos (se filtra en memoria, ya
  // tenemos todos los productos cargados por useProducts).
  const [busquedaProducto, setBusquedaProducto] = useState('')
  const [categoriaProductoActiva, setCategoriaProductoActiva] = useState('Todos')
  // Filtro de stock: "Poco stock" avisa antes de que se agote (antes solo
  // existía "Sin stock", y se enteraba cuando ya no había).
  const [filtroStock, setFiltroStock] = useState<'todos' | 'poco' | 'sin'>('todos')
  const conteoPocoStock = productos.filter((p) => p.stock > 0 && p.stock <= STOCK_BAJO).length
  const conteoSinStock = productos.filter((p) => p.stock <= 0).length

  const productosFiltrados = useMemo(() => {
    return productos.filter((p) => {
      const coincideCat =
        categoriaProductoActiva === 'Todos' || p.categoria_nombre === categoriaProductoActiva
      const coincideTexto = coincideBusqueda(
        busquedaProducto,
        p.nombre,
        p.categoria_nombre,
        p.sku,
        p.descripcion,
      )
      const coincideStock =
        filtroStock === 'todos' ||
        (filtroStock === 'sin' && p.stock <= 0) ||
        (filtroStock === 'poco' && p.stock > 0 && p.stock <= STOCK_BAJO)
      return coincideCat && coincideTexto && coincideStock
    })
  }, [productos, busquedaProducto, categoriaProductoActiva, filtroStock])
  const filtrandoProductos =
    busquedaProducto.trim() !== '' || categoriaProductoActiva !== 'Todos' || filtroStock !== 'todos'
  function limpiarFiltrosProductos() {
    setBusquedaProducto('')
    setCategoriaProductoActiva('Todos')
    setFiltroStock('todos')
  }

  const {
    pedidos,
    conteos,
    loading: cargandoPedidos,
    error: errorPedidos,
    hayMas,
    verMas,
    refetch: refetchPedidos,
  } = useOrders(filtroEstado, busqueda, avisarPedidoNuevo)

  // Pedido nuevo con el panel abierto: aviso con atajo, y vibración en el
  // celular. Antes solo cambiaba el número del badge.
  function avisarPedidoNuevo(pedido: Pedido) {
    if (pedido.origen === 'admin') return // lo acaba de cargar alguien del panel
    navigator.vibrate?.(200)
    notificar(`Nuevo pedido #${pedido.numero} de ${pedido.nombre.split(' ')[0]}`, {
      accion: {
        texto: 'Ver',
        onClick: () => {
          setVista('pedidos')
          setFiltroEstado('nuevo')
        },
      },
    })
  }

  // Pedidos por atender en el título de la pestaña: "(2) Pecora · Panel".
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '')
    document.title = conteos.nuevo > 0 ? `(${conteos.nuevo}) ${base}` : base
  }, [conteos.nuevo])

  // Control de las dos hojas (bottom sheets).
  const [sheetAbierta, setSheetAbierta] = useState(false)
  const [editando, setEditando] = useState<ProductoConCategoria | null>(null)
  const [plantilla, setPlantilla] = useState<ProductoConCategoria | null>(null)
  const [preciosAbierta, setPreciosAbierta] = useState(false)
  const [catSheetAbierta, setCatSheetAbierta] = useState(false)
  const [pedidoSheetAbierta, setPedidoSheetAbierta] = useState(false)

  // Refresca datos de productos/categorías después de cualquier edición.
  const refrescar = useCallback(() => {
    refetchProductos()
    refetchCategorias()
  }, [refetchProductos, refetchCategorias])

  // Mientras se resuelve la sesión no mostramos nada (evita parpadeo).
  if (cargandoSesion) return null

  // Sin sesión => pantalla de login.
  if (!session) {
    return (
      <div className="admin-root">
        <LoginForm />
      </div>
    )
  }

  // Logueado pero sin rol de staff (ej. una clienta) => sin acceso al panel.
  if (!permisos.panel) {
    return (
      <div className="admin-root">
        <div className="login-root">
          <h1>Panel de Pecora</h1>
          <p className="sub">Esta cuenta no tiene acceso al panel de administración.</p>
          <button className="btn btn-ghost" onClick={() => supabase.auth.signOut()}>
            Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  // Exportar catálogo: vista de impresión a pantalla completa. Queda detrás del
  // mismo control de sesión/rol y reusa los datos que ya cargó el panel.
  if (vista === 'exportar') {
    return (
      <CatalogExport
        productos={productos}
        categorias={categorias}
        loading={cargandoProductos || cargandoCategorias}
        error={errorProductos ?? errorCategorias}
        onVolver={() => setVista('productos')}
      />
    )
  }

  const inicial = (session.user.email?.[0] ?? 'A').toUpperCase()
  // Del conteo de la base, no de la página cargada.
  const pedidosNuevos = conteos.nuevo

  function abrirNuevo() {
    setEditando(null)
    setPlantilla(null)
    setSheetAbierta(true)
  }

  function abrirEdicion(producto: ProductoConCategoria) {
    setEditando(producto)
    setPlantilla(null)
    setSheetAbierta(true)
  }

  // "Duplicar": la misma hoja pasa a ser un alta con los datos del producto.
  function duplicar(producto: ProductoConCategoria) {
    setEditando(null)
    setPlantilla(producto)
    setSheetAbierta(true)
  }

  async function cerrarSesion() {
    const ok = await confirmar({
      titulo: '¿Cerrar sesión?',
      mensaje: 'Vas a tener que ingresar de nuevo para entrar al panel.',
      textoOk: 'Cerrar sesión',
    })
    if (ok) await supabase.auth.signOut()
  }

  return (
    <div className="admin-root">
      <div className="phone">
        <div className="topbar">
          <div className="lockup">
            <Logo className="logo-img" />
            <div className="titles">
              <div className="s">{permisos.ajustes ? 'Panel admin' : 'Panel · Empleado'}</div>
            </div>
          </div>
          <button className="avatar" title="Cerrar sesión" onClick={cerrarSesion}>
            {inicial}
          </button>
        </div>

        {/* Pestañas: Productos / Pedidos para todo el staff; Estadísticas y
            Ajustes solo admin. Con 4 en el celular se desplazan de costado. */}
        <div className={permisos.ajustes ? 'admin-tabs admin-tabs--scroll' : 'admin-tabs'}>
          <button
            className={vista === 'productos' ? 'active' : ''}
            onClick={() => setVista('productos')}
          >
            Productos
          </button>
          <button
            className={vista === 'pedidos' ? 'active' : ''}
            onClick={() => setVista('pedidos')}
          >
            Pedidos
            {pedidosNuevos > 0 && <span className="tab-badge">{pedidosNuevos}</span>}
          </button>
          {permisos.estadisticas && (
            <button
              className={vista === 'estadisticas' ? 'active' : ''}
              onClick={() => setVista('estadisticas')}
            >
              Estadísticas
            </button>
          )}
          {permisos.ajustes && (
            <button
              className={vista === 'ajustes' ? 'active' : ''}
              onClick={() => setVista('ajustes')}
            >
              Ajustes
            </button>
          )}
        </div>

        {vista === 'productos' ? (
          <>
            <StatsStrip productos={productos} />
            <div className="list-head">
              <div>
                <h1>Productos</h1>
                <p>Tocá un producto para editarlo.</p>
              </div>
              <div className="head-actions">
                <button className="head-action" onClick={() => setPreciosAbierta(true)}>
                  Ajustar precios
                </button>
                <button className="head-action" onClick={() => setVista('exportar')}>
                  Exportar catálogo
                </button>
              </div>
            </div>
            {miniaturasConProblemas && (
              <p className="head-status">
                Algunas fotos no se pudieron optimizar. Se reintenta solo; si sigue así, avisá a
                soporte.
              </p>
            )}

            {/* Buscador + chips de categoría/stock */}
            <div className="orders-tools">
              <SearchBar
                value={busquedaProducto}
                onChange={setBusquedaProducto}
                placeholder="Buscar por nombre, categoría o SKU"
                className="orders-search"
              />
              <div className="orders-chips">
                <CategoryFilters
                  categorias={categorias.map((c) => c.nombre)}
                  activa={categoriaProductoActiva}
                  onSelect={setCategoriaProductoActiva}
                  className="chip"
                />
                <button
                  type="button"
                  className={filtroStock === 'poco' ? 'chip active' : 'chip'}
                  aria-pressed={filtroStock === 'poco'}
                  onClick={() => setFiltroStock((f) => (f === 'poco' ? 'todos' : 'poco'))}
                >
                  Poco stock{conteoPocoStock > 0 ? ` (${conteoPocoStock})` : ''}
                </button>
                <button
                  type="button"
                  className={filtroStock === 'sin' ? 'chip active' : 'chip'}
                  aria-pressed={filtroStock === 'sin'}
                  onClick={() => setFiltroStock((f) => (f === 'sin' ? 'todos' : 'sin'))}
                >
                  Sin stock{conteoSinStock > 0 ? ` (${conteoSinStock})` : ''}
                </button>
              </div>
            </div>

            {/* Error de red: mensaje propio con reintento (antes caía en
                "Todavía no cargaste ningún producto"). Si ya había una lista
                cargada se sigue mostrando, con el aviso arriba. */}
            {errorProductos && productos.length > 0 && (
              <p className="head-status head-status--error" role="alert">
                No pudimos actualizar la lista.{' '}
                <button className="link-btn" onClick={reintentarProductos} disabled={reintentando}>
                  {reintentando ? 'Reintentando…' : 'Reintentar'}
                </button>
              </p>
            )}
            {errorProductos && productos.length === 0 ? (
              <div className="list">
                <div className="empty">
                  No pudimos cargar los productos.
                  <br />
                  {errorProductos}
                </div>
                <button className="orders-mas" onClick={reintentarProductos} disabled={reintentando}>
                  {reintentando ? 'Reintentando…' : 'Reintentar'}
                </button>
              </div>
            ) : cargandoProductos ? (
              <div className="list">
                <div className="empty">Cargando productos…</div>
              </div>
            ) : (
              <ProductList
                productos={productosFiltrados}
                onEditar={abrirEdicion}
                onChanged={refrescar}
                filtrando={filtrandoProductos}
                onLimpiarFiltros={limpiarFiltrosProductos}
              />
            )}
            <button className="fab" aria-label="Nuevo producto" onClick={abrirNuevo}>
              +<span className="fab-label">Nuevo producto</span>
            </button>
          </>
        ) : vista === 'ajustes' ? (
          <AjustesPanel onProductosImportados={refrescar} />
        ) : vista === 'estadisticas' ? (
          <EstadisticasPanel />
        ) : (
          <>
            <div className="list-head">
              <div>
                <h1>Pedidos</h1>
                <p>
                  {conteos.todos === 0
                    ? 'Los pedidos del muestrario aparecen acá.'
                    : `${conteos.todos} en total · ${pedidosNuevos} sin gestionar.`}
                </p>
              </div>
            </div>

            {/* Buscador + chips de estado */}
            <div className="orders-tools">
              <input
                className="orders-search"
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre, teléfono o nº"
              />
              <div className="orders-chips">
                {FILTROS.map((f) => (
                  <button
                    key={f.valor}
                    className={filtroEstado === f.valor ? 'chip active' : 'chip'}
                    onClick={() => setFiltroEstado(f.valor)}
                  >
                    {f.texto}
                    <span className="chip-num">{conteos[f.valor]}</span>
                  </button>
                ))}
              </div>
            </div>

            <OrdersList
              pedidos={pedidos}
              loading={cargandoPedidos}
              error={errorPedidos}
              onChanged={refetchPedidos}
              hayMas={hayMas}
              onVerMas={verMas}
              filtrando={filtroEstado !== 'todos' || busqueda.trim() !== ''}
              papelera={filtroEstado === 'eliminados'}
              puedeBorrarDefinitivo={permisos.borrarPedidoDefinitivo}
            />
            <button
              className="fab"
              aria-label="Nuevo pedido manual"
              onClick={() => setPedidoSheetAbierta(true)}
            >
              +<span className="fab-label">Nuevo pedido</span>
            </button>
          </>
        )}
      </div>

      {/* Hoja de alta / edición de producto */}
      <ProductFormSheet
        open={sheetAbierta}
        producto={editando}
        categorias={categorias}
        onClose={() => setSheetAbierta(false)}
        onGestionarCategorias={() => setCatSheetAbierta(true)}
        onChanged={refrescar}
        plantilla={plantilla}
        onDuplicar={duplicar}
      />

      {/* Hoja de ajuste de precios en bloque */}
      <AjustarPreciosSheet
        open={preciosAbierta}
        categorias={categorias}
        onClose={() => setPreciosAbierta(false)}
        onChanged={refrescar}
      />

      {/* Hoja de gestión de categorías */}
      <CategoryManagerSheet
        open={catSheetAbierta}
        categorias={categorias}
        productos={productos}
        onClose={() => setCatSheetAbierta(false)}
        onChanged={refrescar}
      />

      {/* Hoja de alta manual de pedido */}
      <ManualOrderSheet
        open={pedidoSheetAbierta}
        onClose={() => setPedidoSheetAbierta(false)}
        onChanged={refetchPedidos}
      />
    </div>
  )
}
