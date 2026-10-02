import type { ProductoConCategoria } from '../../types'
import { STOCK_BAJO } from '../../lib/stock'

type FiltroStock = 'todos' | 'poco' | 'sin'

interface Props {
  productos: ProductoConCategoria[]
  // Tocar un número filtra la lista (mismo filtro que los chips).
  filtro?: FiltroStock
  onFiltrar?: (f: FiltroStock) => void
}

// Franja de números del panel: total de productos, disponibles, con poco
// stock y sin stock. Los de stock bajo/sin stock se destacan si hay alguno y,
// al tocarlos, filtran la lista.
export default function StatsStrip({ productos, filtro = 'todos', onFiltrar }: Props) {
  const total = productos.length
  const disponibles = productos.filter((p) => p.stock > 0).length
  const poco = productos.filter((p) => p.stock > 0 && p.stock <= STOCK_BAJO).length
  const sinStock = productos.filter((p) => p.stock <= 0).length

  const tarjeta = (
    valor: FiltroStock,
    num: number,
    label: string,
    tono: 'neutro' | 'ok' | 'aviso' | 'alerta',
  ) => {
    const activa = filtro === valor && valor !== 'todos'
    const clase = `stat stat--${tono}${num > 0 ? ' stat--con' : ''}${activa ? ' stat--activa' : ''}`
    const contenido = (
      <>
        <div className="num">{num}</div>
        <div className="label">{label}</div>
      </>
    )
    if (!onFiltrar) return <div className={clase}>{contenido}</div>
    return (
      <button
        type="button"
        className={clase}
        aria-pressed={activa}
        onClick={() => onFiltrar(activa ? 'todos' : valor)}
        title={valor === 'todos' ? 'Ver todos' : `Ver ${label.toLowerCase()}`}
      >
        {contenido}
      </button>
    )
  }

  return (
    <div className="stats stats--4">
      {tarjeta('todos', total, 'Productos', 'neutro')}
      {tarjeta('todos', disponibles, 'Disponibles', 'ok')}
      {tarjeta('poco', poco, 'Poco stock', 'aviso')}
      {tarjeta('sin', sinStock, 'Sin stock', 'alerta')}
    </div>
  )
}
