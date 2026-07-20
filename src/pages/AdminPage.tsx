import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useDialog } from '../context/DialogContext'
import { useProducts } from '../hooks/useProducts'
import { useCategories } from '../hooks/useCategories'
import { useOrders, type FiltroEstado } from '../hooks/useOrders'
import type { ProductoConCategoria } from '../types'
import Logo from '../components/Logo'
import LoginForm from '../components/admin/LoginForm'
import StatsStrip from '../components/admin/StatsStrip'
import ProductList from '../components/admin/ProductList'
import ProductFormSheet from '../components/admin/ProductFormSheet'
import CategoryManagerSheet from '../components/admin/CategoryManagerSheet'
import OrdersList from '../components/admin/OrdersList'
import '../styles/admin.css'

type Vista = 'productos' | 'pedidos'

// Chips de filtro de la pestaña Pedidos. El texto es el que usa la clienta en
// "Mis pedidos", para hablar el mismo idioma en las dos puntas.
const FILTROS: { valor: FiltroEstado; texto: string }[] = [
  { valor: 'todos', texto: 'Todos' },
  { valor: 'nuevo', texto: 'Nuevos' },
  { valor: 'confirmado', texto: 'En preparación' },
  { valor: 'entregado', texto: 'Entregados' },
  { valor: 'cancelado', texto: 'Cancelados' },
  { valor: 'eliminados', texto: 'Papelera' },
]

// Vista ADMINISTRADORA (mobile-first), protegida por login.
export default function AdminPage() {
  const { session, esAdmin, loading: cargandoSesion } = useAuth()
  const { productos, refetch: refetchProductos } = useProducts()
  const { categorias, refetch: refetchCategorias } = useCategories()
  const { confirmar } = useDialog()
  const [vista, setVista] = useState<Vista>('productos')

  // Filtro y búsqueda de la pestaña Pedidos (la consulta se hace en la base).
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todos')
  const [busqueda, setBusqueda] = useState('')

  const {
    pedidos,
    conteos,
    loading: cargandoPedidos,
    error: errorPedidos,
    hayMas,
    verMas,
    refetch: refetchPedidos,
  } = useOrders(filtroEstado, busqueda)

  // Control de las dos hojas (bottom sheets).
  const [sheetAbierta, setSheetAbierta] = useState(false)
  const [editando, setEditando] = useState<ProductoConCategoria | null>(null)
  const [catSheetAbierta, setCatSheetAbierta] = useState(false)

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

  // Logueado pero SIN rol admin (ej. una clienta) => sin acceso al panel.
  if (!esAdmin) {
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

  const inicial = (session.user.email?.[0] ?? 'A').toUpperCase()
  // Del conteo de la base, no de la página cargada.
  const pedidosNuevos = conteos.nuevo

  function abrirNuevo() {
    setEditando(null)
    setSheetAbierta(true)
  }

  function abrirEdicion(producto: ProductoConCategoria) {
    setEditando(producto)
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
              <div className="s">Panel admin</div>
            </div>
          </div>
          <button className="avatar" title="Cerrar sesión" onClick={cerrarSesion}>
            {inicial}
          </button>
        </div>

        {/* Pestañas: Productos / Pedidos */}
        <div className="admin-tabs">
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
        </div>

        {vista === 'productos' ? (
          <>
            <StatsStrip productos={productos} />
            <div className="list-head">
              <div>
                <h1>Productos</h1>
                <p>Tocá un producto para editarlo.</p>
              </div>
            </div>
            <ProductList productos={productos} onEditar={abrirEdicion} onChanged={refrescar} />
            <button className="fab" aria-label="Nuevo producto" onClick={abrirNuevo}>
              +
            </button>
          </>
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
            />
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
      />

      {/* Hoja de gestión de categorías */}
      <CategoryManagerSheet
        open={catSheetAbierta}
        categorias={categorias}
        productos={productos}
        onClose={() => setCatSheetAbierta(false)}
        onChanged={refrescar}
      />
    </div>
  )
}
