import type { ProductoConCategoria } from '../../types'

// Franja de estadísticas del panel: total de productos, disponibles y sin stock.
// La disponibilidad se calcula desde stock (stock > 0).
export default function StatsStrip({ productos }: { productos: ProductoConCategoria[] }) {
  const total = productos.length
  const disponibles = productos.filter((p) => p.stock > 0).length
  const sinStock = productos.filter((p) => p.stock === 0).length

  return (
    <div className="stats">
      <div className="stat">
        <div className="num">{total}</div>
        <div className="label">Productos</div>
      </div>
      <div className="stat">
        <div className="num">{disponibles}</div>
        <div className="label">Disponibles</div>
      </div>
      <div className="stat">
        <div className="num">{sinStock}</div>
        <div className="label">Sin stock</div>
      </div>
    </div>
  )
}
