import { useMemo, useState } from 'react'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import SearchBar from '../components/catalog/SearchBar'
import CategoryFilters from '../components/catalog/CategoryFilters'
import ProductGrid from '../components/catalog/ProductGrid'
import { useProducts } from '../hooks/useProducts'
import { useCategories } from '../hooks/useCategories'
import { instagramHabilitado, instagramPerfilLink } from '../lib/config'
import '../styles/catalog.css'

// Vista CLIENTE: muestrario público, sin login.
// Los datos vienen de Supabase y se actualizan solos (Realtime) cuando la
// administradora carga o edita algo.
export default function CatalogPage() {
  const { productos, loading } = useProducts()
  const { categorias } = useCategories()

  const [busqueda, setBusqueda] = useState('')
  const [categoriaActiva, setCategoriaActiva] = useState('Todos')

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
          <ProductGrid productos={visibles} />
        )}
      </main>

      <footer>
        <p>
          Pecora — para consultar y coordinar la compra de cualquier prenda,
          escribinos por WhatsApp{instagramHabilitado ? ' o Instagram' : ''}.
        </p>
        {instagramHabilitado && (
          <a
            className="footer-ig"
            href={instagramPerfilLink()}
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="2" y="2" width="20" height="20" rx="5.5" />
              <circle cx="12" cy="12" r="4.2" />
              <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
            </svg>
            Seguinos en Instagram
          </a>
        )}
      </footer>
    </div>
  )
}
