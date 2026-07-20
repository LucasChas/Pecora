import type { EstadoPedido, Pedido } from '../../types'
import { supabase } from '../../lib/supabaseClient'
import { useDialog } from '../../context/DialogContext'
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
  const { confirmar, avisar } = useDialog()
  const enPapelera = pedido.eliminado_at !== null

  async function cambiarEstado(estado: EstadoPedido) {
    // Cancelar se le avisa a la clienta al instante (realtime) y no hay deshacer:
    // pedimos confirmación para que un toque al pasar no cancele una venta.
    if (estado === 'cancelado') {
      const ok = await confirmar({
        titulo: `¿Cancelar el pedido #${pedido.numero}?`,
        mensaje: `${pedido.nombre} lo va a ver como "Cancelado" y las prendas vuelven al stock.`,
        textoOk: 'Cancelar pedido',
        textoCancelar: 'Volver',
        peligro: true,
      })
      if (!ok) {
        onChanged() // devuelve el select al estado real
        return
      }
    }
    const { error } = await supabase.from('pedidos').update({ estado }).eq('id', pedido.id)
    if (error) await avisar({ titulo: 'No se pudo actualizar el estado', mensaje: error.message })
    else onChanged()
  }

  // "Borrar" manda a la papelera: se puede recuperar desde el filtro Eliminados.
  async function aPapelera() {
    const ok = await confirmar({
      titulo: `¿Borrar el pedido #${pedido.numero}?`,
      mensaje:
        'Va a la papelera: lo podés recuperar desde el filtro "Papelera".' +
        (pedido.estado === 'cancelado' ? '' : ' Las prendas vuelven al stock.') +
        ` El cliente ${pedido.nombre} lo va a ver como cancelado.`,
      textoOk: 'Borrar',
      peligro: true,
    })
    if (!ok) return
    const { error } = await supabase
      .from('pedidos')
      .update({ eliminado_at: new Date().toISOString() })
      .eq('id', pedido.id)
    if (error) await avisar({ titulo: 'No se pudo borrar el pedido', mensaje: error.message })
    else onChanged()
  }

  // Restaurar siempre lo devuelve como "nuevo": un pedido que estuvo en la
  // papelera vuelve a la fila para gestionarse desde cero, sin arrastrar el
  // estado que tenía antes.
  async function restaurar() {
    const ok = await confirmar({
      titulo: `¿Restaurar el pedido #${pedido.numero}?`,
      mensaje:
        'Vuelve a la lista como "Nuevo" para gestionarlo de nuevo' +
        (pedido.estado === 'cancelado' ? ' y las prendas se descuentan del stock.' : '.'),
      textoOk: 'Restaurar',
    })
    if (!ok) return
    const { error } = await supabase
      .from('pedidos')
      .update({ eliminado_at: null, estado: 'nuevo' })
      .eq('id', pedido.id)
    // Si vuelve a reservar stock y no alcanza, el trigger de la 0009 lo impide.
    if (error) await avisar({ titulo: 'No se pudo restaurar el pedido', mensaje: error.message })
    else onChanged()
  }

  async function borrarDefinitivo() {
    const ok = await confirmar({
      titulo: `¿Eliminar para siempre el pedido #${pedido.numero}?`,
      mensaje: 'Esta vez no hay vuelta atrás: no queda registro de la compra.',
      textoOk: 'Eliminar',
      peligro: true,
    })
    if (!ok) return
    // El .select() nos dice qué filas se borraron: si RLS no lo permite, el
    // delete no falla, simplemente no borra nada. Sin esto el botón quedaría mudo.
    const { data, error } = await supabase
      .from('pedidos')
      .delete()
      .eq('id', pedido.id)
      .select('id')
    if (error) {
      await avisar({ titulo: 'No se pudo eliminar el pedido', mensaje: error.message })
      return
    }
    if (!data || data.length === 0) {
      await avisar({
        titulo: 'No se pudo eliminar el pedido',
        mensaje: 'Falta correr la migración 0007_borrar_pedidos.sql en Supabase.',
      })
      return
    }
    onChanged()
  }

  return (
    <div className={`order-card estado-${pedido.estado}${enPapelera ? ' en-papelera' : ''}`}>
      <div className="order-top">
        <div>
          <span className="order-num">Pedido #{pedido.numero}</span>
          <span className="order-fecha">{fecha(pedido.created_at)}</span>
        </div>
        {/* En la papelera no se cambia el estado: primero hay que restaurarlo. */}
        <select
          className={`order-estado ${pedido.estado}`}
          value={pedido.estado}
          disabled={enPapelera}
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

      <div className="order-pie">
        {enPapelera ? (
          <>
            <button type="button" className="order-restaurar" onClick={restaurar}>
              ↩ Restaurar
            </button>
            <button type="button" className="order-borrar" onClick={borrarDefinitivo}>
              Eliminar para siempre
            </button>
          </>
        ) : (
          <button type="button" className="order-borrar" onClick={aPapelera}>
            Borrar pedido
          </button>
        )}
      </div>
    </div>
  )
}
