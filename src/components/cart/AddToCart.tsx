import { useState } from 'react'
import type { ProductoConCategoria } from '../../types'
import { useCart } from '../../context/CartContext'

// Selector de cantidad + botón "Agregar al carrito", para la ficha del producto.
// Si no hay stock, no se muestra (se consulta por WhatsApp/Instagram).
export default function AddToCart({ producto }: { producto: ProductoConCategoria }) {
  const { agregar } = useCart()
  const [cantidad, setCantidad] = useState(1)
  const [agregado, setAgregado] = useState(false)

  if (producto.stock <= 0) return null

  const bajar = () => setCantidad((c) => Math.max(1, c - 1))
  const subir = () => setCantidad((c) => Math.min(producto.stock, c + 1))

  function onAgregar() {
    agregar(producto, cantidad)
    setAgregado(true)
    // Mensaje "agregado" temporal.
    window.setTimeout(() => setAgregado(false), 1800)
  }

  return (
    <div className="add-cart">
      <div className="qty">
        <button type="button" onClick={bajar} aria-label="Restar">
          −
        </button>
        <span>{cantidad}</span>
        <button type="button" onClick={subir} aria-label="Sumar">
          +
        </button>
      </div>
      <button type="button" className="btn btn-primary add-cart-btn" onClick={onAgregar}>
        {agregado ? (
          <span className="added-label">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="added-check-ic"
              aria-hidden="true"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
            Agregado
          </span>
        ) : (
          'Agregar al carrito'
        )}
      </button>
    </div>
  )
}
