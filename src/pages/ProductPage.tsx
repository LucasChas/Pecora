import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { ProductoConCategoria } from '../types'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import HeaderActions from '../components/account/HeaderActions'
import ProductDetailView from '../components/catalog/ProductDetailView'
import RelatedProducts, { type EstadoFicha } from '../components/catalog/RelatedProducts'
import '../styles/catalog.css'
import '../styles/cart.css'

// 'error' (falló la consulta: red, servidor) es distinto de 'no-encontrado'
// (la consulta anduvo pero el producto no existe): el primero se puede reintentar.
type Estado = 'cargando' | 'ok' | 'no-encontrado' | 'error'

// Un producto puede resolverse por su slug (ej: "body-manga-larga") o, para
// links viejos ya compartidos, por su uuid. slugify() nunca puede producir
// algo con esta forma (colapsa corridas de caracteres a un solo guion), así
// que un match del regex siempre es un id y un miss siempre es un slug —
// no hace falta probar las dos columnas.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Página de detalle de un producto, con URL propia (/producto/:param).
// Es compartible (se puede mandar el link) y sienta la base para SEO/ecommerce.
export default function ProductPage() {
  const { param } = useParams<{ param: string }>()
  const [producto, setProducto] = useState<ProductoConCategoria | null>(null)
  const [estado, setEstado] = useState<Estado>('cargando')
  // Sube con "Reintentar" para volver a correr la consulta.
  const [intento, setIntento] = useState(0)
  const location = useLocation()
  const navigate = useNavigate()

  // Si se llegó desde una card del muestrario, "Volver" es un atrás real del
  // historial: conserva ?cat/?q y el ScrollManager restaura la posición. Si se
  // entró por link directo, el href a "/" funciona como siempre. Si en el
  // medio se abrieron relacionados, se retrocede esa cantidad de pasos.
  const estadoNav = location.state as EstadoFicha | null
  const desdeCatalogo = estadoNav?.desdeCatalogo === true
  const pasosAlMuestrario = Math.max(1, estadoNav?.pasosAlMuestrario ?? 1)
  const volverAlMuestrario = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Ctrl/Cmd/Shift + click (abrir en otra pestaña) sigue siendo un link normal.
    if (!desdeCatalogo || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(-pasosAlMuestrario)
  }
  // Estado con el que se abren los relacionados: un paso más lejos del muestrario.
  const estadoRelacionados: EstadoFicha | null = desdeCatalogo
    ? { desdeCatalogo: true, pasosAlMuestrario: pasosAlMuestrario + 1 }
    : null

  // Traemos el producto directamente por slug o id (así funciona incluso si
  // alguien abre el link sin haber pasado por el catálogo). Al pasar de una
  // ficha a otra (relacionados) este componente no se desmonta: el efecto se
  // vuelve a correr porque cambia `param`.
  useEffect(() => {
    let vivo = true
    setEstado('cargando')
    const columna = param && UUID_RE.test(param) ? 'id' : 'slug'

    const cargar = async () => {
      try {
        const { data, error } = await supabase
          .from('productos')
          .select('*, categorias(nombre)')
          .eq(columna, param)
          .maybeSingle()
        if (!vivo) return
        if (error) {
          console.error('No se pudo cargar el producto:', error.message)
          setEstado('error')
          return
        }
        if (!data) {
          setEstado('no-encontrado')
          return
        }
        const { categorias, ...resto } = data as Record<string, unknown> & {
          categorias: { nombre: string } | null
        }
        setProducto({
          ...(resto as unknown as ProductoConCategoria),
          categoria_nombre: categorias?.nombre ?? null,
        })
        setEstado('ok')
      } catch (e) {
        if (!vivo) return
        console.error('No se pudo cargar el producto:', e)
        setEstado('error')
      }
    }

    cargar()
    return () => {
      vivo = false
    }
  }, [param, intento])

  return (
    <div className="catalog-root">
      <header className="cart-header">
        <Link to="/">
          <Logo />
        </Link>
        <HeaderActions />
      </header>
      <Scallop />

      <main className="product-page">
        {estado === 'cargando' && (
          <div className="loading-state">
            <span className="loading-spinner" aria-hidden="true" />
            Cargando producto…
          </div>
        )}

        {estado === 'no-encontrado' && (
          <div className="no-results">
            No encontramos este producto.
            <br />
            <Link className="pp-back" to="/" onClick={volverAlMuestrario}>
              ← Volver al muestrario
            </Link>
          </div>
        )}

        {estado === 'error' && (
          <div className="load-error" role="alert">
            <p className="load-error-title">No pudimos cargar el producto</p>
            <p className="load-error-text">
              Puede ser un problema de conexión. Revisá tu internet y volvé a intentar.
            </p>
            <div className="load-error-actions">
              <button
                type="button"
                className="load-error-btn"
                onClick={() => setIntento((n) => n + 1)}
              >
                Reintentar
              </button>
              <Link className="pp-back" to="/" onClick={volverAlMuestrario}>
                ← Volver al muestrario
              </Link>
            </div>
          </div>
        )}

        {estado === 'ok' && producto && (
          <>
            <p className="pd-breadcrumb pp-breadcrumb">
              <Link to="/">Inicio</Link>
              {producto.categoria_nombre ? ` › ${producto.categoria_nombre}` : ''} ›{' '}
              <span>{producto.nombre}</span>
            </p>

            {/* key: cada producto arranca con la galería y los avisos limpios. */}
            <ProductDetailView key={producto.id} producto={producto} />

            <Link className="pp-back" to="/" onClick={volverAlMuestrario}>
              ← Volver al muestrario
            </Link>

            <RelatedProducts producto={producto} estadoLink={estadoRelacionados} />
          </>
        )}
      </main>
    </div>
  )
}
