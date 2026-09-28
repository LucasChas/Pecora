import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import SearchBar from '../components/common/SearchBar'
import CategoryFilters from '../components/common/CategoryFilters'
import ProductGrid from '../components/catalog/ProductGrid'
import MasVendidos from '../components/catalog/MasVendidos'
import HeaderActions from '../components/account/HeaderActions'
import { useProducts } from '../hooks/useProducts'
import { useCategories } from '../hooks/useCategories'
import '../styles/catalog.css'
import '../styles/cart.css'

// Vista CLIENTE: muestrario público, sin login.
// La categoría y la búsqueda viven en la URL (?cat=...&q=...): así el filtro es
// compartible, el botón "atrás" funciona y al volver de un producto se conserva.
export default function CatalogPage() {
  const { productos, loading, error, refetch } = useProducts()
  const { categorias } = useCategories()

  // Errores de carga (ver useProducts): sin datos se muestra un panel de error;
  // con la lista en caché, se sigue mostrando y se avisa que puede estar vieja.
  const [reintentando, setReintentando] = useState(false)
  const [avisoCerrado, setAvisoCerrado] = useState(false)
  // Tras una carga exitosa, un error posterior vuelve a mostrar el aviso.
  useEffect(() => {
    if (!error) setAvisoCerrado(false)
  }, [error])

  const reintentar = async () => {
    setReintentando(true)
    try {
      await refetch()
    } finally {
      setReintentando(false)
    }
  }

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

  // "Lo más vendido" solo en la portada: sin búsqueda ni categoría elegida.
  const sinFiltros = !busqueda.trim() && categoriaActiva === 'Todos'

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
          <div className="loading-state">
            <span className="loading-spinner" aria-hidden="true" />
            Cargando muestrario…
          </div>
        ) : productos.length === 0 && error ? (
          // Arranque en frío fallido: no hay nada que mostrar.
          <div className="load-error" role="alert">
            <p className="load-error-title">No pudimos cargar el muestrario</p>
            <p className="load-error-text">
              Puede ser un problema de conexión. Revisá tu internet y volvé a intentar.
            </p>
            <div className="load-error-actions">
              <button
                type="button"
                className="load-error-btn"
                onClick={reintentar}
                disabled={reintentando}
              >
                {reintentando ? 'Reintentando…' : 'Reintentar'}
              </button>
            </div>
          </div>
        ) : productos.length === 0 ? (
          // Carga correcta pero sin productos (distinto de "tu búsqueda no dio resultados").
          <div className="no-results">Todavía no hay productos en el muestrario.</div>
        ) : (
          <>
            {/* Falló un refresco pero hay lista en caché: se sigue mostrando. */}
            {error && !avisoCerrado && (
              <div className="load-notice" role="status">
                <p className="load-notice-text">
                  No pudimos actualizar el muestrario. Los precios y el stock podrían no
                  estar al día.
                </p>
                <div className="load-notice-actions">
                  <button
                    type="button"
                    className="load-notice-retry"
                    onClick={reintentar}
                    disabled={reintentando}
                  >
                    {reintentando ? 'Reintentando…' : 'Reintentar'}
                  </button>
                  <button
                    type="button"
                    className="load-notice-close"
                    aria-label="Cerrar aviso"
                    onClick={() => setAvisoCerrado(true)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
            {sinFiltros && <MasVendidos productos={productos} />}
            <ProductGrid productos={visibles} />
          </>
        )}
      </main>
    </div>
  )
}
