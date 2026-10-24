import { Link } from 'react-router-dom'
import type { ProductoConCategoria } from '../../types'
import { money } from '../../lib/format'
import { portadaDe } from '../../lib/images'
import { avisoStockBajo } from '../../lib/stock'
import { formatearPromedio, textoCantidad } from '../../lib/resenas'
import { useResumenesResenas } from '../../hooks/useResumenesResenas'
import Miniatura from '../common/Miniatura'
import BotonFavorito from './BotonFavorito'
import { useCart } from '../../context/CartContext'
import { tieneTalles } from '../../lib/productosConsulta'
import { esNovedad } from '../../lib/filtrosCatalogo'

// Card de producto del catálogo: foto (con mouse, al pasar por encima se ve
// la segunda), nombre, estrellas si tiene reseñas y precio siempre a la misma
// altura. Sin categoría ni descripción: eso queda para la ficha y así entra
// una fila más por pantalla en el celular.
// Etiquetas: "Nuevo" (cargado hace menos de 14 días) y "Queda 1" (stock 1). Si stock = 0: foto atenuada, cinta "Agotado" y un botón para
// pedir el aviso de reposición (lleva a la ficha, donde está el formulario).
// Tocar la card (imagen o nombre) abre la página del producto.
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
  const nuevo = disponible && !stockBajo && esNovedad(producto.created_at)
  const resumen = useResumenesResenas()?.get(producto.id)
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
              {producto.stock === 1 ? 'Queda 1' : `Quedan ${producto.stock}`}
            </span>
          )}
          {nuevo && <span className="badge badge--nuevo">Nuevo</span>}
        </div>
        <div className="card-body">
          <h3>{producto.nombre}</h3>
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
          <Link
            className="card-avisar"
            to={`/producto/${producto.slug ?? producto.id}`}
            state={{ desdeCatalogo: true }}
            aria-label={`Avisarme cuando vuelva ${producto.nombre}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" />
              <path d="M10 21h4" />
            </svg>
            Avisarme
          </Link>
        </div>
      )}
    </div>
  )
}
