import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import SearchBar from '../components/catalog/SearchBar'
import CategoryFilters from '../components/catalog/CategoryFilters'
import ProductGrid from '../components/catalog/ProductGrid'
import HeaderActions from '../components/account/HeaderActions'
import { useProducts } from '../hooks/useProducts'
import { useCategories } from '../hooks/useCategories'
import '../styles/catalog.css'
import '../styles/cart.css'

// Vista CLIENTE: muestrario público, sin login.
// La categoría y la búsqueda viven en la URL (?cat=...&q=...): así el filtro es
// compartible, el botón "atrás" funciona y al volver de un producto se conserva.
export default function CatalogPage() {
  const { productos, loading } = useProducts()
  const { categorias } = useCategories()

  const [params, setParams] = useSearchParams()
  const busqueda = params.get('q') ?? ''
  const categoriaActiva = params.get('cat') ?? 'Todos'

  // Actualiza un parámetro de la URL sin perder los demás.
  const setBusqueda = (v: string) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (v) p.set('q', v)
        else p.delete('q')
        return p
      },
      { replace: true }, // no llenamos el historial en cada tecla
    )

  const setCategoria = (c: string) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      if (c && c !== 'Todos') p.set('cat', c)
      else p.delete('cat')
      return p
    })

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
      <header className="cart-header">
        <Logo />
        <HeaderActions />
      </header>

      {/* Borde festoneado: elemento de marca */}
      <Scallop />

      <SearchBar value={busqueda} onChange={setBusqueda} />

      <main>
        <CategoryFilters
          categorias={categorias.map((c) => c.nombre)}
          activa={categoriaActiva}
          onSelect={setCategoria}
        />

        {loading ? (
          <div className="no-results">Cargando muestrario…</div>
        ) : (
          <ProductGrid productos={visibles} />
        )}
      </main>
    </div>
  )
}
