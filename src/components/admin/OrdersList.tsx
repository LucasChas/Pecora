import type { Pedido } from '../../types'
import OrderCard from './OrderCard'

interface Props {
  pedidos: Pedido[]
  loading: boolean
  error: string | null
  onChanged: () => void
  hayMas: boolean
  onVerMas: () => void
  // Si hay filtro o búsqueda activos, el mensaje de "vacío" es distinto.
  filtrando: boolean
  papelera: boolean
}

// Lista de pedidos del panel. Contempla el estado de carga, error (típico si
// falta correr la migración 0003) y vacío.
export default function OrdersList({
  pedidos,
  loading,
  error,
  onChanged,
  hayMas,
  onVerMas,
  filtrando,
  papelera,
}: Props) {
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
          {papelera ? (
            <>
              La papelera está vacía.
              <br />
              Los pedidos que borres van a parar acá y podés recuperarlos.
            </>
          ) : filtrando ? (
            <>
              Ningún pedido coincide con la búsqueda.
              <br />
              Probá con otro nombre, teléfono o número.
            </>
          ) : (
            <>
              Todavía no hay pedidos.
              <br />
              Cuando una clienta finalice una compra en el muestrario, aparece acá.
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="list">
      {pedidos.map((p) => (
        <OrderCard key={p.id} pedido={p} onChanged={onChanged} />
      ))}
      {hayMas && (
        <button type="button" className="orders-mas" onClick={onVerMas}>
          Ver más pedidos
        </button>
      )}
    </div>
  )
}
