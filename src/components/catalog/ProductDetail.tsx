import { useEffect, useState } from 'react'
import type { ProductoConCategoria } from '../../types'
import { money } from '../../lib/format'
import { waLink } from '../../lib/config'
import { imagenesDe } from '../../lib/images'

interface Props {
  producto: ProductoConCategoria
  onClose: () => void
}

// Vista de detalle de un producto (modal "quick view"): galería de imágenes
// (foto grande + miniaturas), nombre, categoría, precio, descripción y botón
// de WhatsApp. Replica el layout de una ficha de producto, responsive.
export default function ProductDetail({ producto, onClose }: Props) {
  const imagenes = imagenesDe(producto)
  const [activa, setActiva] = useState(0)
  const disponible = producto.stock > 0

  // Cerrar con la tecla Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="pd-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="pd-panel">
        <button className="pd-close" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>

        {/* Galería */}
        <div className="pd-gallery">
          <div className={disponible ? 'pd-main' : 'pd-main unavailable'}>
            <img src={imagenes[activa]} alt={producto.nombre} />
            {!disponible && <span className="badge">Sin stock</span>}
          </div>

          {imagenes.length > 1 && (
            <div className="pd-thumbs">
              {imagenes.map((src, i) => (
                <button
                  key={i}
                  className={i === activa ? 'pd-thumb active' : 'pd-thumb'}
                  onClick={() => setActiva(i)}
                  aria-label={`Imagen ${i + 1}`}
                >
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Información */}
        <div className="pd-info">
          <p className="pd-breadcrumb">
            Inicio {producto.categoria_nombre ? `› ${producto.categoria_nombre}` : ''} ›{' '}
            <span>{producto.nombre}</span>
          </p>

          <h2 className="pd-name">{producto.nombre}</h2>
          <p className={disponible ? 'pd-price' : 'pd-price off'}>{money(producto.precio)}</p>

          {!disponible && <p className="pd-stock-msg">Sin stock por el momento.</p>}

          {producto.descripcion && <p className="pd-desc">{producto.descripcion}</p>}

          <a
            className="wa-btn pd-wa"
            href={waLink(producto)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.5 14.4c-.3-.1-1.7-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.3-.4.1-.2 0-.4 0-.5C10 9 9.4 7.6 9.1 7c-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-.2.3-1 .9-1 2.3s1 2.7 1.1 2.9c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3z" />
              <path d="M12 2C6.5 2 2 6.5 2 12c0 1.9.5 3.6 1.5 5.2L2 22l4.9-1.3c1.5.8 3.2 1.3 5.1 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18.2c-1.7 0-3.3-.5-4.7-1.3l-.3-.2-3.5 1 1-3.4-.2-.3C3.5 14.7 3 13.4 3 12c0-5 4-9 9-9s9 4 9 9-4 9-9 9z" />
            </svg>
            {disponible ? 'Consultar por WhatsApp' : 'Consultar disponibilidad'}
          </a>
        </div>
      </div>
    </div>
  )
}
