import type { EstadoPedido, Pedido } from '../../types'
import { supabase } from '../../lib/supabaseClient'
import { money } from '../../lib/format'

interface Props {
  pedido: Pedido
  onChanged: () => void
}

const ESTADOS: EstadoPedido[] = ['nuevo', 'confirmado', 'entregado', 'cancelado']

// Arma un link de WhatsApp al teléfono de la clienta (normaliza el número a AR).
function waCliente(telefono: string, numero: number): string {
  let d = telefono.replace(/\D/g, '')
  if (d.startsWith('0')) d = d.slice(1)
  if (!d.startsWith('54')) d = '549' + d
  const msg = `Hola! Te escribo por tu pedido #${numero} en Pecora 🐑`
  return `https://wa.me/${d}?text=${encodeURIComponent(msg)}`
}

function fecha(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Card de un pedido en el panel: datos de la clienta, entrega, ítems, subtotal
// y un selector para cambiar el estado.
export default function OrderCard({ pedido, onChanged }: Props) {
  async function cambiarEstado(estado: EstadoPedido) {
    const { error } = await supabase.from('pedidos').update({ estado }).eq('id', pedido.id)
    if (error) alert('No se pudo actualizar el estado: ' + error.message)
    else onChanged()
  }

  return (
    <div className={`order-card estado-${pedido.estado}`}>
      <div className="order-top">
        <div>
          <span className="order-num">Pedido #{pedido.numero}</span>
          <span className="order-fecha">{fecha(pedido.created_at)}</span>
        </div>
        <select
          className={`order-estado ${pedido.estado}`}
          value={pedido.estado}
          onChange={(e) => cambiarEstado(e.target.value as EstadoPedido)}
        >
          {ESTADOS.map((es) => (
            <option key={es} value={es}>
              {es}
            </option>
          ))}
        </select>
      </div>

      <div className="order-cliente">
        <strong>{pedido.nombre}</strong>
        <a className="order-wa" href={waCliente(pedido.telefono, pedido.numero)} target="_blank" rel="noopener noreferrer">
          {pedido.telefono} · WhatsApp
        </a>
        {pedido.email && <span className="order-email">{pedido.email}</span>}
      </div>

      <div className="order-entrega">
        {pedido.entrega === 'envio' ? (
          <>
            📦 Envío a: {pedido.direccion}, {pedido.localidad} (CP {pedido.cp})
          </>
        ) : (
          <>🛍️ Retiro / a coordinar</>
        )}
      </div>

      <div className="order-items">
        {pedido.items.map((i, idx) => (
          <div className="order-item" key={idx}>
            <span>
              {i.cantidad}x {i.nombre}
            </span>
            <span>{money(i.precio * i.cantidad)}</span>
          </div>
        ))}
        <div className="order-item total">
          <span>Subtotal</span>
          <strong>{money(pedido.subtotal)}</strong>
        </div>
      </div>

      {pedido.notas && <p className="order-notas">📝 {pedido.notas}</p>}
    </div>
  )
}
