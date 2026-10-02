import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import BuscadorCatalogo from '../components/catalog/BuscadorCatalogo'
import BandaConfianza from '../components/catalog/BandaConfianza'
import CategoryFilters from '../components/common/CategoryFilters'
import ProductGrid from '../components/catalog/ProductGrid'
import MasVendidos from '../components/catalog/MasVendidos'
import HeaderActions from '../components/account/HeaderActions'
import { useProducts } from '../hooks/useProducts'
import { useCategories } from '../hooks/useCategories'
import { coincideBusqueda } from '../lib/format'
import { OPCIONES_ORDEN, ordenDeUrl, ordenarCatalogo } from '../lib/ordenCatalogo'
import { enRango, leerRangoUrl, rangosDePrecio } from '../lib/filtrosCatalogo'
import '../styles/catalog.css'
import '../styles/cart.css'
import { useTitulo } from '../hooks/useTitulo'

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
  const orden = ordenDeUrl(params.get('orden'))
  const precioUrl = params.get('precio')
  const rango = leerRangoUrl(precioUrl)
  const soloDisponibles = params.get('stock') === '1'
  useTitulo(busqueda.trim() ? `Buscar "${busqueda.trim()}"` : categoriaActiva !== 'Todos' ? categoriaActiva : null)

  const setOrden = (v: string) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (v && v !== 'novedades') p.set('orden', v)
        else p.delete('orden')
        return p
      },
      { replace: true },
    )

  // Filtros de precio y stock: también en la URL, sin llenar el historial.
  const setParam = (clave: string, valor: string | null) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (valor) p.set(clave, valor)
        else p.delete(clave)
        return p
      },
      { replace: true },
    )
  const limpiarFiltros = () =>
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      for (const k of ['q', 'cat', 'precio', 'stock']) p.delete(k)
      return p
    })

  // Rangos según los precios de lo que hay (tercios con cortes redondos).
  const rangos = useMemo(() => rangosDePrecio(productos.map((p) => p.precio)), [productos])

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

  // Filtrado por categoría + término de búsqueda (nombre, descripción,
  // categoría; sin importar acentos ni el orden de las palabras) y orden.
  const visibles = useMemo(() => {
    const filtrados = productos.filter((p) => {
      const coincideCat =
        categoriaActiva === 'Todos' || p.categoria_nombre === categoriaActiva
      return (
        coincideCat &&
        enRango(p.precio, rango) &&
        (!soloDisponibles || p.stock > 0) &&
        coincideBusqueda(busqueda, p.nombre, p.descripcion, p.categoria_nombre)
      )
    })
    return ordenarCatalogo(filtrados, orden)
  }, [productos, busqueda, categoriaActiva, orden, rango?.min, rango?.max, soloDisponibles])

  // "Lo más vendido" solo en la portada: sin búsqueda ni filtros.
  const sinFiltros = !busqueda.trim() && categoriaActiva === 'Todos' && !rango && !soloDisponibles

  return (
    <div className="catalog-root">
      <header className="cart-header">
        <Logo />
        <HeaderActions />
      </header>

      {/* Borde festoneado: elemento de marca */}
      <Scallop />

      <BuscadorCatalogo value={busqueda} onChange={setBusqueda} productos={productos} />

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
            {sinFiltros && <BandaConfianza />}
            {sinFiltros && <MasVendidos productos={productos} />}
            <div className="catalogo-barra">
              <h2 className="catalogo-titulo">
                {busqueda.trim()
                  ? 'Resultados'
                  : categoriaActiva === 'Todos'
                    ? 'Todo el muestrario'
                    : categoriaActiva}
                <span className="catalogo-cuenta">
                  {visibles.length === 1 ? '1 producto' : `${visibles.length} productos`}
                </span>
              </h2>
            </div>
            <div className="catalogo-filtros" role="group" aria-label="Filtrar y ordenar">
              {rangos.length > 0 && (
                <label className="filtro-select">
                  <span className="sr-only">Precio</span>
                  <select
                    value={rango ? (precioUrl ?? '') : ''}
                    onChange={(e) => setParam('precio', e.target.value || null)}
                    aria-label="Filtrar por precio"
                  >
                    <option value="">Todos los precios</option>
                    {rangos.map((r) => (
                      <option key={r.valor} value={r.valor}>
                        {r.texto}
                      </option>
                    ))}
                    {/* Un rango de un link viejo que ya no está en la lista. */}
                    {rango && !rangos.some((r) => r.valor === precioUrl) && (
                      <option value={precioUrl ?? ''}>Rango elegido</option>
                    )}
                  </select>
                </label>
              )}
              <button
                type="button"
                className={soloDisponibles ? 'filtro-toggle activo' : 'filtro-toggle'}
                aria-pressed={soloDisponibles}
                onClick={() => setParam('stock', soloDisponibles ? null : '1')}
              >
                {soloDisponibles && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
                Solo disponibles
              </button>
              <label className="filtro-select filtro-orden">
                <span className="filtro-etiqueta">Ordenar</span>
                <select id="orden-catalogo" value={orden} onChange={(e) => setOrden(e.target.value)}>
                  {OPCIONES_ORDEN.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.texto}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {visibles.length === 0 ? (
              <div className="no-results no-results--filtros">
                <p>No encontramos productos con esos filtros.</p>
                <button type="button" className="load-error-btn" onClick={limpiarFiltros}>
                  Ver todo el muestrario
                </button>
              </div>
            ) : (
              <ProductGrid productos={visibles} />
            )}
          </>
        )}
      </main>
    </div>
  )
}
