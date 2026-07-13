import type { ProductoConCategoria } from '../../types'
import { money } from '../../lib/format'
import { waLink } from '../../lib/config'
import { portadaDe } from '../../lib/images'

interface Props {
  producto: ProductoConCategoria
  onSelect: (producto: ProductoConCategoria) => void
}

// Card de producto del catálogo. Si stock = 0: card grisada, badge "Sin stock"
// y el botón cambia de texto (mismo link de WhatsApp, mensaje distinto).
// Tocar la card (imagen, nombre o descripción) abre el detalle con la galería.
export default function ProductCard({ producto, onSelect }: Props) {
  const disponible = producto.stock > 0
  const cantidadFotos = (producto.imagenes ?? []).filter(Boolean).length

  return (
    <div className={disponible ? 'card' : 'card unavailable'}>
      <button
        type="button"
        className="card-open"
        onClick={() => onSelect(producto)}
        aria-label={`Ver ${producto.nombre}`}
      >
        <div className="card-img">
          <img src={portadaDe(producto)} alt={producto.nombre} />
          {!disponible && <span className="badge">Sin stock</span>}
          {cantidadFotos > 1 && <span className="photo-count">{cantidadFotos} fotos</span>}
        </div>
        <div className="card-body">
          <h3>{producto.nombre}</h3>
          <p className="desc">{producto.descripcion}</p>
          <p className="price">{money(producto.precio)}</p>
        </div>
      </button>

      <div className="card-cta">
        <a className="wa-btn" href={waLink(producto)} target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.5 14.4c-.3-.1-1.7-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.3-.4.1-.2 0-.4 0-.5C10 9 9.4 7.6 9.1 7c-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-.2.3-1 .9-1 2.3s1 2.7 1.1 2.9c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3z" />
            <path d="M12 2C6.5 2 2 6.5 2 12c0 1.9.5 3.6 1.5 5.2L2 22l4.9-1.3c1.5.8 3.2 1.3 5.1 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18.2c-1.7 0-3.3-.5-4.7-1.3l-.3-.2-3.5 1 1-3.4-.2-.3C3.5 14.7 3 13.4 3 12c0-5 4-9 9-9s9 4 9 9-4 9-9 9z" />
          </svg>
          {disponible ? 'Consultar por WhatsApp' : 'Consultar disponibilidad'}
        </a>
      </div>
    </div>
  )
}
