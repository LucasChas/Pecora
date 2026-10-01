import { useCallback, useEffect, useRef, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import type { ProductoConCategoria } from '../../types'
import { money } from '../../lib/format'
import { waLink, instagramHabilitado, instagramDmLink } from '../../lib/config'
import { imagenesDe } from '../../lib/images'
import { avisoStockBajo } from '../../lib/stock'
import { compartirProducto, copiarLink, puedeCompartirNativo } from '../../lib/share'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import {
  MENSAJE_NO_DISPONIBLE,
  cancelarAviso,
  consultarAviso,
  suscribirAviso,
} from '../../lib/avisos'
import AddToCart from '../cart/AddToCart'
import ImageZoom from '../common/ImageZoom'
import Miniatura from '../common/Miniatura'
import { Estrellas } from './ResenasProducto'
import { estrellasDePromedio, formatearPromedio, textoCantidad } from '../../lib/resenas'
import { useResumenesResenas } from '../../hooks/useResumenesResenas'

// Cuánto dura a la vista la confirmación de "Copiar link".
const DURACION_AVISO_COPIA = 2500

// Contenido del detalle de un producto (galería + info). Es presentacional:
// lo usa la página /producto/:id. No maneja navegación.
export default function ProductDetailView({ producto }: { producto: ProductoConCategoria }) {
  const imagenes = imagenesDe(producto)
  const disponible = producto.stock > 0
  const stockBajo = avisoStockBajo(producto.stock)
  const variasFotos = imagenes.length > 1
  const resumen = useResumenesResenas()?.get(producto.id)

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
                      alt={i === 0 ? producto.nombre : `${producto.nombre}, foto ${i + 1}`}
                      loading={i === 0 ? undefined : 'lazy'}
                      // La primera foto es lo más importante de la página.
                      // (En minúscula: React 18 no conoce fetchPriority.)
                      {...(i === 0 ? { fetchpriority: 'high' } : {})}
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
                  aria-label={`Ver foto ${i + 1}`}
                  aria-current={i === activa ? 'true' : undefined}
                >
                  {/* Miniatura liviana: antes bajaba cada foto original
                      (~1400 px) para mostrarla a 58 px. */}
                  <Miniatura src={src} alt="" width={58} height={58} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Información */}
        <div className="pd-info">
          {producto.categoria_nombre && <p className="pd-cat">{producto.categoria_nombre}</p>}
          <h1 className="pd-name">{producto.nombre}</h1>
          {resumen && resumen.cantidad > 0 && (
            <a className="pd-rating" href="#rs-titulo">
              <Estrellas
                llenas={estrellasDePromedio(resumen.promedio).llenas}
                media={estrellasDePromedio(resumen.promedio).media}
                etiqueta={`${formatearPromedio(resumen.promedio)} de 5 estrellas`}
              />
              <span>
                {formatearPromedio(resumen.promedio)} · {textoCantidad(resumen.cantidad)}
              </span>
            </a>
          )}
          <p className={disponible ? 'pd-price' : 'pd-price off'}>{money(producto.precio)}</p>

          {!disponible && <p className="pd-stock-msg">Sin stock por el momento.</p>}
          {disponible && stockBajo && <p className="pd-low-stock">{stockBajo}</p>}

          {producto.descripcion && <p className="pd-desc">{producto.descripcion}</p>}

          {/* CTA principal de ecommerce: agregar al carrito */}
          <AddToCart producto={producto} />

          {/* "Avisame cuando vuelva": mail cuando vuelva a haber stock. */}
          {!disponible && <AvisoReposicion productoId={producto.id} />}

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

          {disponible ? (
            <ul className="pd-garantias">
              <li>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z" />
                </svg>
                Pagás y coordinás la entrega por WhatsApp
              </li>
              <li>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 8L12 3 3 8v8l9 5 9-5V8z" />
                  <path d="M3 8l9 5 9-5" />
                </svg>
                Retiro o envío a domicilio
              </li>
            </ul>
          ) : (
            <p className="pd-note">Escribinos por WhatsApp o Instagram para consultar disponibilidad.</p>
          )}

          {/* Compartir: al final y en chico, para no competir con "Agregar al
              carrito" ni con los botones de consulta. */}
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

        </div>
      </div>

      {/* Fuera de .pd-content a propósito: embla aplica transform al track y un
          overlay position:fixed dentro de él quedaría atrapado en ese contenedor. */}
      {zoom && <ImageZoom src={zoom} alt={producto.nombre} onClose={cerrarZoom} />}
    </>
  )
}

type EstadoAviso =
  | { tipo: 'cargando' }
  | { tipo: 'libre' }
  | { tipo: 'suscripta'; email: string }
  | { tipo: 'no_disponible' }

// "Avisame cuando vuelva" (solo productos sin stock). Pide cuenta: el mail sale
// al email de la cuenta, que la base toma del lado del servidor.
function AvisoReposicion({ productoId }: { productoId: string }) {
  const { session, loading } = useAuth()
  const { pathname, search } = useLocation()
  const userId = session?.user.id ?? null
  const [estado, setEstado] = useState<EstadoAviso>({ tipo: 'cargando' })
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const montadoRef = useRef(true)

  useEffect(() => {
    montadoRef.current = true
    return () => {
      montadoRef.current = false
    }
  }, [])

  // Al montar (o al cambiar de producto o de cuenta): ¿ya está anotada?
  useEffect(() => {
    if (!userId) return
    let vigente = true
    setEstado({ tipo: 'cargando' })
    setError(null)
    consultarAviso(productoId).then((r) => {
      if (!vigente) return
      if (r.ok) setEstado(r.valor ? { tipo: 'suscripta', email: r.valor } : { tipo: 'libre' })
      else if (r.error === MENSAJE_NO_DISPONIBLE) setEstado({ tipo: 'no_disponible' })
      else setEstado({ tipo: 'libre' })
    })
    return () => {
      vigente = false
    }
  }, [productoId, userId])

  const onSuscribir = async () => {
    setOcupado(true)
    setError(null)
    const r = await suscribirAviso(productoId)
    if (!montadoRef.current) return
    setOcupado(false)
    if (r.ok) setEstado({ tipo: 'suscripta', email: r.valor })
    else setError(r.error)
  }

  const onCancelar = async () => {
    setOcupado(true)
    setError(null)
    const r = await cancelarAviso(productoId)
    if (!montadoRef.current) return
    setOcupado(false)
    if (r.ok) setEstado({ tipo: 'libre' })
    else setError(r.error)
  }

  if (estado.tipo === 'no_disponible') return null

  const campana = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )

  let contenido: React.ReactNode
  if (!loading && !userId) {
    contenido = (
      <Link className="aviso-btn" to={`/cuenta?next=${encodeURIComponent(pathname + search)}`}>
        {campana}
        Ingresá para que te avisemos
      </Link>
    )
  } else if (estado.tipo === 'suscripta') {
    contenido = (
      <>
        <p className="aviso-ok" role="status">
          Te vamos a avisar por mail a <strong>{estado.email}</strong>.
        </p>
        <button type="button" className="aviso-cancelar" onClick={onCancelar} disabled={ocupado}>
          {ocupado ? 'Cancelando…' : 'Cancelar aviso'}
        </button>
      </>
    )
  } else {
    const cargando = loading || estado.tipo === 'cargando'
    contenido = (
      <button
        type="button"
        className="aviso-btn"
        onClick={onSuscribir}
        disabled={cargando || ocupado}
        aria-busy={cargando || ocupado}
      >
        {campana}
        {ocupado ? 'Anotando…' : 'Avisame cuando vuelva'}
      </button>
    )
  }

  return (
    <section className="aviso-stock" aria-label="Aviso de reposición">
      <p className="aviso-texto">¿Lo querés? Te mandamos un mail cuando vuelva a haber stock.</p>
      <div className="aviso-cuerpo">{contenido}</div>
      {error && (
        <p className="aviso-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
