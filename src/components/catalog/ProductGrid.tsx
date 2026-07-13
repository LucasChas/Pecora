import type { ProductoConCategoria } from '../../types'
import ProductCard from './ProductCard'

interface Props {
  productos: ProductoConCategoria[]
  onSelect: (producto: ProductoConCategoria) => void
}

// Grilla de productos del catálogo. Muestra un mensaje si no hay resultados.
export default function ProductGrid({ productos, onSelect }: Props) {
  return (
    <div className="grid">
      {productos.length === 0 ? (
        <div className="no-results">
          No encontramos productos que coincidan con tu búsqueda.
        </div>
      ) : (
        productos.map((p) => <ProductCard key={p.id} producto={p} onSelect={onSelect} />)
      )}
    </div>
  )
}
