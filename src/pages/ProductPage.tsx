import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { ProductoConCategoria } from '../types'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import CartIcon from '../components/cart/CartIcon'
import ProductDetailView from '../components/catalog/ProductDetailView'
import '../styles/catalog.css'
import '../styles/cart.css'

type Estado = 'cargando' | 'ok' | 'no-encontrado'

// Página de detalle de un producto, con URL propia (/producto/:id).
// Es compartible (se puede mandar el link) y sienta la base para SEO/ecommerce.
export default function ProductPage() {
  const { id } = useParams<{ id: string }>()
  const [producto, setProducto] = useState<ProductoConCategoria | null>(null)
  const [estado, setEstado] = useState<Estado>('cargando')

  // Traemos el producto directamente por id (así funciona incluso si alguien
  // abre el link sin haber pasado por el catálogo).
  useEffect(() => {
    let vivo = true
    setEstado('cargando')
    supabase
      .from('productos')
      .select('*, categorias(nombre)')
      .eq('id', id)
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
  }, [id])

  return (
    <div className="catalog-root">
      <header className="cart-header">
        <Link to="/">
          <Logo />
        </Link>
        <p>Accesorios de bebé · Muestrario</p>
        <CartIcon />
      </header>
      <Scallop />

      <main className="product-page">
        {estado === 'cargando' && <p className="no-results">Cargando producto…</p>}

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
