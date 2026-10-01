import type { ProductoConCategoria } from '../../types'
import ProductCard from './ProductCard'

interface Props {
  productos: ProductoConCategoria[]
  onEditar: (producto: ProductoConCategoria) => void
  // Se llama después de una edición inline para refrescar los datos.
  onChanged: () => void
  // Hay búsqueda o filtros activos: una lista vacía no es "no hay productos".
  filtrando?: boolean
  onLimpiarFiltros?: () => void
}

// Lista de productos del panel (cards, no tabla).
export default function ProductList({ productos, onEditar, onChanged, filtrando, onLimpiarFiltros }: Props) {
  if (productos.length === 0 && filtrando) {
    return (
      <div className="list">
        <div className="empty">
          Ningún producto coincide con la búsqueda o los filtros.
          <br />
          {onLimpiarFiltros && (
            <button type="button" className="link-btn" onClick={onLimpiarFiltros}>
              Limpiar filtros
            </button>
          )}
        </div>
      </div>
    )
  }

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
        <ProductCard key={p.id} producto={p} onEditar={onEditar} onChanged={onChanged} />
      ))}
    </div>
  )
}
