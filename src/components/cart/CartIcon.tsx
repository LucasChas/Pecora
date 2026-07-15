import { Link } from 'react-router-dom'
import { useCart } from '../../context/CartContext'

// Ícono de carrito con la cantidad de ítems. Va en el header del catálogo y
// lleva a la página del carrito (/carrito).
export default function CartIcon() {
  const { cantidadTotal } = useCart()
  return (
    <Link to="/carrito" className="cart-icon" aria-label={`Carrito (${cantidadTotal})`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="20" r="1.4" />
        <circle cx="18" cy="20" r="1.4" />
        <path d="M2 3h2l2.2 12.2a1 1 0 0 0 1 .8h9.4a1 1 0 0 0 1-.8L20 7H5" />
      </svg>
      {cantidadTotal > 0 && <span className="cart-count">{cantidadTotal}</span>}
    </Link>
  )
}
