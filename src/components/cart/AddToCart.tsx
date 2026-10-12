import { useState } from 'react'
import type { ProductoConCategoria } from '../../types'
import { claveItem, MAX_POR_PRODUCTO, maximoPedible, useCart } from '../../context/CartContext'
import { tieneTalles } from '../../lib/productosConsulta'
import GuiaTalles from '../catalog/GuiaTalles'

// Selector de talle (si el producto se vende por talle) + cantidad + botón
// "Agregar al carrito", para la ficha del producto. Si no hay stock, no se
// muestra (se consulta por WhatsApp/Instagram).
export default function AddToCart({ producto }: { producto: ProductoConCategoria }) {
  const { agregar, items } = useCart()
  const [cantidad, setCantidad] = useState(1)
  const [agregado, setAgregado] = useState(false)
  const [guiaAbierta, setGuiaAbierta] = useState(false)
  const conTalles = tieneTalles(producto)
  const talles = producto.talles ?? []
  // Con un solo talle disponible, ya viene elegido.
  const [talleId, setTalleId] = useState<string | null>(() => {
    const conStock = talles.filter((t) => t.stock > 0)
    return conStock.length === 1 && talles.length === 1 ? conStock[0].id : null
  })
  const [faltaTalle, setFaltaTalle] = useState(false)

  if (producto.stock <= 0) return null

  const talle = conTalles ? (talles.find((t) => t.id === talleId) ?? null) : null
  const stock = conTalles ? (talle?.stock ?? 0) : producto.stock

  // Lo que ya está en el carrito cuenta contra el stock (del talle elegido) y
  // contra el tope por producto de la compra web.
  const enCarrito =
    items.find((i) => claveItem(i) === claveItem({ id: producto.id, talleId: talle?.id }))?.cantidad ?? 0
  const disponible = Math.max(0, maximoPedible({ stock }) - enCarrito)
  const elegida = Math.min(cantidad, Math.max(1, disponible))

  const bajar = () => setCantidad(Math.max(1, elegida - 1))
  const subir = () => setCantidad(Math.min(disponible, elegida + 1))

  function onAgregar() {
    if (conTalles && !talle) {
      setFaltaTalle(true)
      return
    }
    if (disponible <= 0) return
    agregar(producto, elegida, talle)
    setCantidad(1)
    setAgregado(true)
    // Mensaje "agregado" temporal.
    window.setTimeout(() => setAgregado(false), 1800)
  }

  return (
    <div className="add-cart">
      {conTalles && (
        <div className="talles" role="radiogroup" aria-label="Talle" aria-describedby={faltaTalle ? 'talles-error' : undefined}>
          <div className="talles-head">
            <span className="talles-titulo">
              Talle{talle ? <strong>: {talle.talle}</strong> : ''}
            </span>
            <button type="button" className="talles-guia" onClick={() => setGuiaAbierta(true)}>
              Guía de talles
            </button>
          </div>
          <div className="talles-opciones">
            {talles.map((t) => {
              const sinStock = t.stock <= 0
              const elegido = t.id === talleId
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={elegido}
                  className={`talle${elegido ? ' elegido' : ''}${sinStock ? ' agotado' : ''}`}
                  disabled={sinStock}
                  title={sinStock ? 'Sin stock' : t.stock <= 3 ? `Quedan ${t.stock}` : undefined}
                  onClick={() => {
                    setTalleId(t.id)
                    setCantidad(1)
                    setFaltaTalle(false)
                  }}
                >
                  {t.talle}
                </button>
              )
            })}
          </div>
          {talle && talle.stock <= 3 && (
            <p className="talles-poco">{talle.stock === 1 ? 'Último disponible en este talle' : `Quedan ${talle.stock} en este talle`}</p>
          )}
          {faltaTalle && (
            <p className="talles-error" id="talles-error" role="alert">
              Elegí un talle para agregarlo al carrito.
            </p>
          )}
          <GuiaTalles abierta={guiaAbierta} onCerrar={() => setGuiaAbierta(false)} />
        </div>
      )}
      <div className="qty">
        <button type="button" onClick={bajar} aria-label="Restar una unidad" disabled={elegida <= 1 || (conTalles && !talle)}>
          −
        </button>
        <span aria-live="polite" aria-label={`Cantidad: ${elegida}`}>
          {elegida}
        </span>
        <button
          type="button"
          onClick={subir}
          aria-label="Sumar una unidad"
          disabled={elegida >= disponible || (conTalles && !talle)}
        >
          +
        </button>
      </div>
      <button
        type="button"
        className="btn btn-primary add-cart-btn"
        onClick={onAgregar}
        disabled={!(conTalles && !talle) && disponible <= 0 && !agregado}
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
        ) : conTalles && !talle ? (
          'Elegí un talle'
        ) : disponible <= 0 ? (
          stock > MAX_POR_PRODUCTO
            ? `Máximo ${MAX_POR_PRODUCTO} por compra`
            : 'Ya tenés todo el stock en el carrito'
        ) : (
          'Agregar al carrito'
        )}
      </button>
      {disponible <= 0 && stock > MAX_POR_PRODUCTO && (
        <p className="add-cart-nota">
          Ya tenés {enCarrito} en el carrito. Si necesitás más, escribinos por WhatsApp.
        </p>
      )}
      {enCarrito > 0 && disponible > 0 && (
        <p className="add-cart-nota">
          Ya tenés {enCarrito} en el carrito · podés sumar {disponible} más.
        </p>
      )}
    </div>
  )
}
