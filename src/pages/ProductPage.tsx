import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { ProductoConCategoria } from '../types'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import HeaderActions from '../components/account/HeaderActions'
import ProductDetailView from '../components/catalog/ProductDetailView'
import '../styles/catalog.css'
import '../styles/cart.css'

type Estado = 'cargando' | 'ok' | 'no-encontrado'

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

  // Traemos el producto directamente por slug o id (así funciona incluso si
  // alguien abre el link sin haber pasado por el catálogo).
  useEffect(() => {
    let vivo = true
    setEstado('cargando')
    const columna = param && UUID_RE.test(param) ? 'id' : 'slug'
    supabase
      .from('productos')
      .select('*, categorias(nombre)')
      .eq(columna, param)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return
        if (error || !data) {
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
      })
    return () => {
      vivo = false
    }
  }, [param])

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
            <Link className="pp-back" to="/">
              ← Volver al muestrario
            </Link>
          </div>
        )}

        {estado === 'ok' && producto && (
          <>
            <p className="pd-breadcrumb pp-breadcrumb">
              <Link to="/">Inicio</Link>
              {producto.categoria_nombre ? ` › ${producto.categoria_nombre}` : ''} ›{' '}
              <span>{producto.nombre}</span>
            </p>

            <ProductDetailView producto={producto} />

            <Link className="pp-back" to="/">
              ← Volver al muestrario
            </Link>
          </>
        )}
      </main>
    </div>
  )
}
