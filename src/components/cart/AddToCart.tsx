import { useState } from 'react'
import type { ProductoConCategoria } from '../../types'
import { useCart } from '../../context/CartContext'

// Selector de cantidad + botón "Agregar al carrito", para la ficha del producto.
// Si no hay stock, no se muestra (se consulta por WhatsApp/Instagram).
export default function AddToCart({ producto }: { producto: ProductoConCategoria }) {
  const { agregar, items } = useCart()
  const [cantidad, setCantidad] = useState(1)
  const [agregado, setAgregado] = useState(false)

  if (producto.stock <= 0) return null

  // Lo que ya está en el carrito cuenta contra el stock: antes se podía elegir
  // 3 con 2 ya agregados y en silencio se sumaba 1.
  const enCarrito = items.find((i) => i.id === producto.id)?.cantidad ?? 0
  const disponible = Math.max(0, producto.stock - enCarrito)
  const elegida = Math.min(cantidad, Math.max(1, disponible))

  const bajar = () => setCantidad(Math.max(1, elegida - 1))
  const subir = () => setCantidad(Math.min(disponible, elegida + 1))

  function onAgregar() {
    if (disponible <= 0) return
    agregar(producto, elegida)
    setCantidad(1)
    setAgregado(true)
    // Mensaje "agregado" temporal.
    window.setTimeout(() => setAgregado(false), 1800)
  }

  return (
    <div className="add-cart">
      <div className="qty">
        <button type="button" onClick={bajar} aria-label="Restar una unidad" disabled={elegida <= 1}>
          −
        </button>
        <span aria-live="polite" aria-label={`Cantidad: ${elegida}`}>
          {elegida}
        </span>
        <button type="button" onClick={subir} aria-label="Sumar una unidad" disabled={elegida >= disponible}>
          +
        </button>
      </div>
      <button
        type="button"
        className="btn btn-primary add-cart-btn"
        onClick={onAgregar}
        disabled={disponible <= 0 && !agregado}
      >
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
        ) : disponible <= 0 ? (
          'Ya tenés todo el stock en el carrito'
        ) : (
          'Agregar al carrito'
        )}
      </button>
      {enCarrito > 0 && disponible > 0 && (
        <p className="add-cart-nota">
          Ya tenés {enCarrito} en el carrito · podés sumar {disponible} más.
        </p>
      )}
    </div>
  )
}
