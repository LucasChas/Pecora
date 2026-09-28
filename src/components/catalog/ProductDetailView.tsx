import { useCallback, useEffect, useRef, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import type { ProductoConCategoria } from '../../types'
import { money } from '../../lib/format'
import { waLink, instagramHabilitado, instagramDmLink } from '../../lib/config'
import { imagenesDe } from '../../lib/images'
import { avisoStockBajo } from '../../lib/stock'
import { compartirProducto, copiarLink, puedeCompartirNativo } from '../../lib/share'
import AddToCart from '../cart/AddToCart'
import ImageZoom from '../common/ImageZoom'

// Cuánto dura a la vista la confirmación de "Copiar link".
const DURACION_AVISO_COPIA = 2500

// Contenido del detalle de un producto (galería + info). Es presentacional:
// lo usa la página /producto/:id. No maneja navegación.
export default function ProductDetailView({ producto }: { producto: ProductoConCategoria }) {
  const imagenes = imagenesDe(producto)
  const disponible = producto.stock > 0
  const stockBajo = avisoStockBajo(producto.stock)
  const variasFotos = imagenes.length > 1

  // Carrusel de imágenes (D9): embla maneja swipe/touch; el strip de
  // miniaturas existente pasa a ser un controlador (scrollTo / selectedScrollSnap).
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false })
  const [activa, setActiva] = useState(0)
  const [puedeAnterior, setPuedeAnterior] = useState(false)
  const [puedeSiguiente, setPuedeSiguiente] = useState(false)
  const [zoom, setZoom] = useState<string | null>(null)
  const thumbsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!emblaApi) return
    const onSelect = () => {
      setActiva(emblaApi.selectedScrollSnap())
      setPuedeAnterior(emblaApi.canScrollPrev())
      setPuedeSiguiente(emblaApi.canScrollNext())
    }
    emblaApi.on('select', onSelect)
    emblaApi.on('reInit', onSelect)
    onSelect()
    return () => {
      emblaApi.off('select', onSelect)
      emblaApi.off('reInit', onSelect)
    }
  }, [emblaApi])

  // Mantiene visible (centrada) la miniatura activa cuando el strip scrollea
  // en horizontal (mobile). Se mueve solo el strip: scrollIntoView también
  // movería la página.
  useEffect(() => {
    const strip = thumbsRef.current
    if (!strip || strip.scrollWidth <= strip.clientWidth) return
    const thumb = strip.children[activa] as HTMLElement | undefined
    if (!thumb) return
    const desplazamiento =
      thumb.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft
    strip.scrollTo({
      left: desplazamiento - (strip.clientWidth - thumb.offsetWidth) / 2,
      behavior: 'smooth',
    })
  }, [activa])

  const irAImagen = useCallback(
    (i: number) => {
      emblaApi?.scrollTo(i)
    },
    [emblaApi],
  )

  const cerrarZoom = useCallback(() => setZoom(null), [])

  // Compartir (roadmap #2). Sin hoja nativa (ej. Firefox de escritorio) el
  // botón abre WhatsApp, y el texto lo dice para que no sorprenda.
  const [compartirNativo] = useState(puedeCompartirNativo)
  const [avisoCopia, setAvisoCopia] = useState<'ok' | 'error' | null>(null)
  const timerAvisoRef = useRef(0)

  useEffect(() => () => window.clearTimeout(timerAvisoRef.current), [])

  const onCopiarLink = async () => {
    const ok = await copiarLink(producto)
    setAvisoCopia(ok ? 'ok' : 'error')
    window.clearTimeout(timerAvisoRef.current)
    timerAvisoRef.current = window.setTimeout(() => setAvisoCopia(null), DURACION_AVISO_COPIA)
  }

  return (
    <>
      <div className="pd-content">
        {/* Galería */}
        <div className="pd-gallery">
          <div
            className={disponible ? 'pd-main' : 'pd-main unavailable'}
            ref={emblaRef}
          >
            <div className="pd-main-viewport">
              {imagenes.map((src, i) => (
                <div className="pd-main-slide" key={i}>
                  {/* Tocar la foto la amplía. Embla ya cancela el click cuando
                      el gesto fue un arrastre (swipe), así que no choca con el carrusel. */}
                  <button
                    type="button"
                    className="pd-zoom-btn"
                    aria-label="Ampliar foto"
                    onClick={() => setZoom(src)}
                  >
                    {/* Solo la primera foto se pide de entrada; el resto,
                        cuando se acerca a la vista. */}
                    <img
                      src={src}
                      alt={producto.nombre}
                      loading={i === 0 ? undefined : 'lazy'}
                    />
                  </button>
                </div>
              ))}
            </div>
            {!disponible && <span className="badge">Sin stock</span>}
            {/* Flechas para mouse (en pantallas táctiles se ocultan por CSS). */}
            {variasFotos && (
              <>
                <button
                  type="button"
                  className="pd-nav prev"
                  aria-label="Foto anterior"
                  onClick={() => emblaApi?.scrollPrev()}
                  disabled={!puedeAnterior}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 6l-6 6 6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="pd-nav next"
                  aria-label="Foto siguiente"
                  onClick={() => emblaApi?.scrollNext()}
                  disabled={!puedeSiguiente}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {variasFotos && (
            <div className="pd-thumbs" ref={thumbsRef}>
              {imagenes.map((src, i) => (
                <button
                  key={i}
                  type="button"
                  className={i === activa ? 'pd-thumb active' : 'pd-thumb'}
                  onClick={() => irAImagen(i)}
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

          {/* Compartir: acciones secundarias (outline chico), para no competir
              con "Agregar al carrito" ni con los botones de consulta. */}
          <div className="pd-share">
            <button
              type="button"
              className="pd-share-btn"
              onClick={() => compartirProducto(producto)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
              </svg>
              {compartirNativo ? 'Compartir' : 'Compartir por WhatsApp'}
            </button>
            <button type="button" className="pd-share-btn" onClick={onCopiarLink}>
              {avisoCopia === 'ok' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
                  <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
                </svg>
              )}
              {avisoCopia === 'ok' ? '¡Link copiado!' : 'Copiar link'}
            </button>
            {/* Anuncio para lectores de pantalla (siempre montado para que el
                cambio se anuncie). Lo visual es el texto del botón / el aviso. */}
            <span className="pd-share-status" role="status" aria-live="polite">
              {avisoCopia === 'ok' && '¡Link copiado!'}
              {avisoCopia === 'error' && 'No pudimos copiar el link.'}
            </span>
          </div>
          {avisoCopia === 'error' && (
            <p className="pd-share-error" aria-hidden="true">
              No pudimos copiar el link.
            </p>
          )}

          {!disponible && <p className="pd-stock-msg">Sin stock por el momento.</p>}
          {disponible && stockBajo && <p className="pd-low-stock">{stockBajo}</p>}

          {producto.descripcion && <p className="pd-desc">{producto.descripcion}</p>}

          {/* CTA principal de ecommerce: agregar al carrito */}
          <AddToCart producto={producto} />

          {/* Consulta directa (WhatsApp / Instagram) — solo si no hay stock */}
          {!disponible && (
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
                Consultar disponibilidad
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
          )}

          {/* TODO(owner-copy): revisar esta copy una vez definido el texto final. */}
          <p className="pd-note">
            {disponible
              ? 'Agregalo al carrito y completá el pedido desde el checkout.'
              : 'Escribinos por WhatsApp o Instagram para consultar disponibilidad.'}
          </p>
        </div>
      </div>

      {/* Fuera de .pd-content a propósito: embla aplica transform al track y un
          overlay position:fixed dentro de él quedaría atrapado en ese contenedor. */}
      {zoom && <ImageZoom src={zoom} alt={producto.nombre} onClose={cerrarZoom} />}
    </>
  )
}
