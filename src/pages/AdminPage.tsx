import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { useProducts } from '../hooks/useProducts'
import { useCategories } from '../hooks/useCategories'
import { useOrders } from '../hooks/useOrders'
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

// Vista ADMINISTRADORA (mobile-first), protegida por login.
export default function AdminPage() {
  const { session, loading: cargandoSesion } = useAuth()
  const { productos, refetch: refetchProductos } = useProducts()
  const { categorias, refetch: refetchCategorias } = useCategories()
  const { pedidos, loading: cargandoPedidos, error: errorPedidos, refetch: refetchPedidos } = useOrders()

  const [vista, setVista] = useState<Vista>('productos')

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

  const inicial = (session.user.email?.[0] ?? 'A').toUpperCase()
  const pedidosNuevos = pedidos.filter((p) => p.estado === 'nuevo').length

  function abrirNuevo() {
    setEditando(null)
    setSheetAbierta(true)
  }

  function abrirEdicion(producto: ProductoConCategoria) {
    setEditando(producto)
    setSheetAbierta(true)
  }

  async function cerrarSesion() {
    if (confirm('¿Cerrar sesión?')) await supabase.auth.signOut()
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
                  {pedidos.length === 0
                    ? 'Los pedidos del muestrario aparecen acá.'
                    : `${pedidos.length} en total · ${pedidosNuevos} sin gestionar.`}
                </p>
              </div>
            </div>
            <OrdersList
              pedidos={pedidos}
              loading={cargandoPedidos}
              error={errorPedidos}
              onChanged={refetchPedidos}
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
