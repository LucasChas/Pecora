import type { Pedido } from '../../types'
import OrderCard from './OrderCard'

interface Props {
  pedidos: Pedido[]
  loading: boolean
  error: string | null
  onChanged: () => void
}

// Lista de pedidos del panel. Contempla el estado de carga, error (típico si
// falta correr la migración 0003) y vacío.
export default function OrdersList({ pedidos, loading, error, onChanged }: Props) {
  if (error) {
    return (
      <div className="list">
        <div className="empty">
          No pudimos cargar los pedidos.
          <br />
          {error.includes('pedidos') || error.includes('schema') ? (
            <>Falta correr la migración <code>0003_pedidos.sql</code> en Supabase.</>
          ) : (
            error
          )}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="list">
        <div className="empty">Cargando pedidos…</div>
      </div>
    )
  }

  if (pedidos.length === 0) {
    return (
      <div className="list">
        <div className="empty">
          Todavía no hay pedidos.
          <br />
          Cuando una clienta finalice una compra en el muestrario, aparece acá.
        </div>
      </div>
    )
  }

  return (
    <div className="list">
      {pedidos.map((p) => (
        <OrderCard key={p.id} pedido={p} onChanged={onChanged} />
      ))}
    </div>
  )
}
