import { Link } from 'react-router-dom'
import type { ProductoConCategoria } from '../../types'
import { money } from '../../lib/format'
import { waLink, instagramHabilitado, instagramDmLink } from '../../lib/config'
import { portadaDe } from '../../lib/images'
import { avisoStockBajo } from '../../lib/stock'
import { formatearPromedio, textoCantidad } from '../../lib/resenas'
import { useResumenesResenas } from '../../hooks/useResumenesResenas'
import Miniatura from '../common/Miniatura'
import BotonFavorito from './BotonFavorito'
import { useCart } from '../../context/CartContext'
import { tieneTalles } from '../../lib/productosConsulta'

// Card de producto del catálogo: foto (con mouse, al pasar por encima se ve
// la segunda), categoría, nombre, descripción en dos líneas, estrellas si
// tiene reseñas y precio siempre a la misma altura. Si stock = 0: foto
// atenuada, cinta "Agotado" y botón para consultar por WhatsApp.
// Tocar la card (imagen, nombre o descripción) abre la página del producto.
export default function ProductCard({
  producto,
  prioritaria = false,
}: {
  producto: ProductoConCategoria
  // Está en la primera fila: carga inmediata en vez de diferida.
  prioritaria?: boolean
}) {
  const disponible = producto.stock > 0
  const fotos = (producto.imagenes ?? []).filter(Boolean)
  const segunda = fotos.length > 1 ? fotos[1] : null
  const stockBajo = avisoStockBajo(producto.stock)
  const resumen = useResumenesResenas()?.get(producto.id)
  // En la card la descripción va en un solo párrafo (los saltos de línea de
  // la ficha acá cortaban el recorte de dos líneas).
  const descripcion = (producto.descripcion ?? '').replace(/\s+/g, ' ').trim()
  const { items, agregar } = useCart()
  const conTalles = tieneTalles(producto)
  const enCarrito = items
    .filter((i) => i.id === producto.id)
    .reduce((n, i) => n + i.cantidad, 0)
  const llegoAlTope = !conTalles && enCarrito >= producto.stock

  return (
    <div className={disponible ? 'card' : 'card unavailable'}>
      <BotonFavorito productoId={producto.id} nombre={producto.nombre} />
      {/* Agregar sin abrir la ficha: botón sobre la esquina de la foto (fuera
          del link, para no anidar un botón dentro de un enlace). */}
      {disponible && conTalles && (
        // Con talles hay que elegir uno: el botón lleva a la ficha.
        <div className="card-rapido">
          <Link
            to={`/producto/${producto.slug ?? producto.id}`}
            state={{ desdeCatalogo: true }}
            className={enCarrito > 0 ? 'card-agregar en-carrito' : 'card-agregar'}
            aria-label={`Elegir talle de ${producto.nombre}`}
            title="Elegir talle"
          >
            {enCarrito > 0 ? (
              <span className="card-agregar-num">{enCarrito}</span>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.2" />
                <path d="M13 10v4M11 12h4" />
              </svg>
            )}
          </Link>
        </div>
      )}
      {disponible && !conTalles && (
        <div className="card-rapido">
          <button
            type="button"
            className={enCarrito > 0 ? 'card-agregar en-carrito' : 'card-agregar'}
            onClick={() => agregar(producto)}
            disabled={llegoAlTope}
            aria-label={
              llegoAlTope
                ? `${producto.nombre}: ya tenés todo el stock en el carrito`
                : `Agregar ${producto.nombre} al carrito`
            }
            title={llegoAlTope ? 'Ya tenés todo el stock en el carrito' : 'Agregar al carrito'}
          >
            {enCarrito > 0 ? (
              <span className="card-agregar-num">{enCarrito}</span>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.2" />
                <path d="M13 10v4M11 12h4" />
              </svg>
            )}
          </button>
        </div>
      )}
      {/* desdeCatalogo: el "Volver al muestrario" de la ficha usa el historial
          (conserva filtros y scroll) en vez de navegar a "/" de cero. */}
      <Link
        to={`/producto/${producto.slug ?? producto.id}`}
        state={{ desdeCatalogo: true }}
        className="card-open"
        aria-label={`Ver ${producto.nombre}`}
      >
        <div className="card-img">
          {/* Miniatura liviana (cae al original si falta), carga diferida.
              width/height = caja cuadrada del CSS (.card-img): sin saltos. */}
          <Miniatura
            src={portadaDe(producto)}
            alt={producto.nombre}
            width={480}
            height={480}
            loading={prioritaria ? 'eager' : 'lazy'}
          />
          {segunda && disponible && (
            <Miniatura
              className="card-img-alt"
              src={segunda}
              alt=""
              aria-hidden="true"
              width={480}
              height={480}
              loading="lazy"
            />
          )}
          {!disponible && <span className="badge">Agotado</span>}
          {disponible && stockBajo && (
            <span className="badge badge--pocas">
              {producto.stock === 1 ? 'Último disponible' : `Quedan ${producto.stock}`}
            </span>
          )}
        </div>
        <div className="card-body">
          {producto.categoria_nombre && <p className="card-cat">{producto.categoria_nombre}</p>}
          <h3>{producto.nombre}</h3>
          {descripcion && <p className="desc">{descripcion}</p>}
          <div className="card-pie">
            <p className="price">{money(producto.precio)}</p>
            {resumen && resumen.cantidad > 0 && (
              <p
                className="card-rating"
                aria-label={`${formatearPromedio(resumen.promedio)} de 5 estrellas, ${textoCantidad(resumen.cantidad)}`}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" />
                </svg>
                {formatearPromedio(resumen.promedio)}
                <span>({resumen.cantidad})</span>
              </p>
            )}
          </div>
        </div>
      </Link>

      {!disponible && (
        <div className="card-cta">
          <a
            className="wa-btn"
            href={waLink(producto)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Consultar por WhatsApp si vuelve ${producto.nombre}`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.5 14.4c-.3-.1-1.7-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.3-.4.1-.2 0-.4 0-.5C10 9 9.4 7.6 9.1 7c-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-.2.3-1 .9-1 2.3s1 2.7 1.1 2.9c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3z" />
              <path d="M12 2C6.5 2 2 6.5 2 12c0 1.9.5 3.6 1.5 5.2L2 22l4.9-1.3c1.5.8 3.2 1.3 5.1 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18.2c-1.7 0-3.3-.5-4.7-1.3l-.3-.2-3.5 1 1-3.4-.2-.3C3.5 14.7 3 13.4 3 12c0-5 4-9 9-9s9 4 9 9-4 9-9 9z" />
            </svg>
            Consultar
          </a>

          {instagramHabilitado && (
            <a
              className="ig-btn"
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
      )}
    </div>
  )
}
