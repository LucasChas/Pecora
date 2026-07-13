import { useMemo, useState } from 'react'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import SearchBar from '../components/catalog/SearchBar'
import CategoryFilters from '../components/catalog/CategoryFilters'
import ProductGrid from '../components/catalog/ProductGrid'
import ProductDetail from '../components/catalog/ProductDetail'
import { useProducts } from '../hooks/useProducts'
import { useCategories } from '../hooks/useCategories'
import type { ProductoConCategoria } from '../types'
import '../styles/catalog.css'

// Vista CLIENTE: muestrario público, sin login.
// Los datos vienen de Supabase y se actualizan solos (Realtime) cuando la
// administradora carga o edita algo.
export default function CatalogPage() {
  const { productos, loading } = useProducts()
  const { categorias } = useCategories()

  const [busqueda, setBusqueda] = useState('')
  const [categoriaActiva, setCategoriaActiva] = useState('Todos')
  // Producto abierto en el detalle (modal). null = ninguno.
  const [seleccionado, setSeleccionado] = useState<ProductoConCategoria | null>(null)

  // Filtrado por categoría + término de búsqueda (nombre, descripción, categoría).
  const visibles = useMemo(() => {
    const term = busqueda.trim().toLowerCase()
    return productos.filter((p) => {
      const coincideCat =
        categoriaActiva === 'Todos' || p.categoria_nombre === categoriaActiva
      const coincideTexto =
        !term ||
        p.nombre.toLowerCase().includes(term) ||
        (p.descripcion ?? '').toLowerCase().includes(term) ||
        (p.categoria_nombre ?? '').toLowerCase().includes(term)
      return coincideCat && coincideTexto
    })
  }, [productos, busqueda, categoriaActiva])

  return (
    <div className="catalog-root">
      <header>
        <Logo />
        <p>Accesorios de bebé · Muestrario</p>
      </header>

      {/* Borde festoneado: elemento de marca */}
      <Scallop />

      <SearchBar value={busqueda} onChange={setBusqueda} />

      <main>
        <CategoryFilters
          categorias={categorias.map((c) => c.nombre)}
          activa={categoriaActiva}
          onSelect={setCategoriaActiva}
        />

        {loading ? (
          <div className="no-results">Cargando muestrario…</div>
        ) : (
          <ProductGrid productos={visibles} onSelect={setSeleccionado} />
        )}
      </main>

      <footer>
        Pecora — para consultar y coordinar la compra de cualquier prenda,
        escribinos por WhatsApp.
      </footer>

      {/* Detalle de producto (galería + info). Se abre al tocar un producto. */}
      {seleccionado && (
        <ProductDetail producto={seleccionado} onClose={() => setSeleccionado(null)} />
      )}
    </div>
  )
}
