import { Link, useNavigate } from 'react-router-dom'
import { money } from '../../lib/format'
import type { CartItem } from '../../context/CartContext'

interface Props {
  waHref: string
  entrega: 'envio' | 'coordinar'
  items: CartItem[]
  subtotal: number
}

// Modal de éxito tras confirmar un pedido: check animado, agradecimiento y el
// desglose de lo comprado. El número de orden no se muestra acá (le sirve a la
// marca, no a la clienta): viaja en el mensaje de WhatsApp y está en /mis-pedidos.
export default function OrderSuccess({ waHref, entrega, items, subtotal }: Props) {
  const navigate = useNavigate()
  const volver = () => navigate('/')

  return (
    <div className="success-overlay" onClick={volver}>
      <div className="success-card" onClick={(e) => e.stopPropagation()}>
        <div className="success-check">
          <svg viewBox="0 0 52 52">
            <circle className="success-check-circle" cx="26" cy="26" r="24" fill="none" />
            <path className="success-check-mark" fill="none" d="M14 27l8 8 16-16" />
          </svg>
        </div>

        <h2 className="success-title">¡Gracias por tu compra!</h2>
        <p className="success-text">
          Gracias por confiar en Pecora 🐑 Ya tenemos tu pedido y lo estamos preparando con
          mucho cariño.
        </p>

        {/* Desglose de lo comprado, para que la clienta se lleve el detalle a la vista. */}
        <div className="success-detalle">
          {items.map((i) => (
            <div className="success-linea" key={i.id}>
              <span>
                {i.cantidad}x {i.nombre}
              </span>
              <span>{money(i.precio * i.cantidad)}</span>
            </div>
          ))}
          <div className="success-linea total">
            <span>Total</span>
            <strong>{money(subtotal)}</strong>
          </div>
          <div className="success-entrega">
            {entrega === 'envio' ? '📦 Envío a domicilio' : '🛍️ Retiro / a coordinar'}
          </div>
        </div>

        <p className="success-text">
          Escribinos por WhatsApp y coordinamos
          {entrega === 'envio' ? ' el pago y el envío' : ' el pago y la entrega'}:
        </p>

        <a className="btn btn-primary" href={waHref} target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" fill="currentColor" className="success-wa-ic">
            <path d="M17.5 14.4c-.3-.1-1.7-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.3-.4.1-.2 0-.4 0-.5C10 9 9.4 7.6 9.1 7c-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-.2.3-1 .9-1 2.3s1 2.7 1.1 2.9c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3z" />
            <path d="M12 2C6.5 2 2 6.5 2 12c0 1.9.5 3.6 1.5 5.2L2 22l4.9-1.3c1.5.8 3.2 1.3 5.1 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18.2c-1.7 0-3.3-.5-4.7-1.3l-.3-.2-3.5 1 1-3.4-.2-.3C3.5 14.7 3 13.4 3 12c0-5 4-9 9-9s9 4 9 9-4 9-9 9z" />
          </svg>
          Coordinar por WhatsApp
        </a>

        <Link className="success-link" to="/mis-pedidos">
          Ver el estado de mi pedido
        </Link>
        <button className="success-volver" onClick={volver}>
          Volver al muestrario
        </button>
      </div>
    </div>
  )
}
