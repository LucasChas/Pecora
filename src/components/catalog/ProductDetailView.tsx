import { useState } from 'react'
import type { ProductoConCategoria } from '../../types'
import { money } from '../../lib/format'
import { waLink, instagramHabilitado, instagramDmLink } from '../../lib/config'
import { imagenesDe } from '../../lib/images'
import { avisoStockBajo } from '../../lib/stock'

// Contenido del detalle de un producto (galería + info). Es presentacional:
// lo usa la página /producto/:id. No maneja overlay ni navegación.
export default function ProductDetailView({ producto }: { producto: ProductoConCategoria }) {
  const imagenes = imagenesDe(producto)
  const [activa, setActiva] = useState(0)
  const disponible = producto.stock > 0
  const stockBajo = avisoStockBajo(producto.stock)

  return (
    <div className="pd-content">
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
        <h1 className="pd-name">{producto.nombre}</h1>
        <p className={disponible ? 'pd-price' : 'pd-price off'}>{money(producto.precio)}</p>

        {!disponible && <p className="pd-stock-msg">Sin stock por el momento.</p>}
        {disponible && stockBajo && <p className="pd-low-stock">{stockBajo}</p>}

        {producto.descripcion && <p className="pd-desc">{producto.descripcion}</p>}

        <div className="pd-actions">
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

          {instagramHabilitado && (
            <a
              className="ig-btn pd-ig"
              href={instagramDmLink()}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="2" y="2" width="20" height="20" rx="5.5" />
                <circle cx="12" cy="12" r="4.2" />
                <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
              </svg>
              Consultar por Instagram
            </a>
          )}
        </div>

        <p className="pd-note">
          Coordinás el pago y el envío escribiéndonos por WhatsApp o Instagram.
        </p>
      </div>
    </div>
  )
}
