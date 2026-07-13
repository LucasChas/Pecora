import type { ProductoConCategoria } from '../../types'
import ProductCard from './ProductCard'

interface Props {
  productos: ProductoConCategoria[]
  onEditar: (producto: ProductoConCategoria) => void
}

// Lista de productos del panel (cards, no tabla).
export default function ProductList({ productos, onEditar }: Props) {
  if (productos.length === 0) {
    return (
      <div className="list">
        <div className="empty">
          Todavía no cargaste ningún producto.
          <br />
          Tocá el botón + para agregar el primero.
        </div>
      </div>
    )
  }

  return (
    <div className="list">
      {productos.map((p) => (
        <ProductCard key={p.id} producto={p} onEditar={onEditar} />
      ))}
    </div>
  )
}
