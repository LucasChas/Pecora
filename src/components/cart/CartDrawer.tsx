import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { claveItem, maximoPedible, nombreConTalle, useCart } from '../../context/CartContext'
import { money } from '../../lib/format'
import { portadaDe } from '../../lib/images'
import { sugerenciasCarrito } from '../../lib/relacionados'
import { productosEnCache } from '../../hooks/useProducts'
import Miniatura from '../common/Miniatura'

// Carrito lateral (drawer) que se desliza desde la derecha. Es la vista rápida
// del carrito: se abre al agregar un producto o al tocar el ícono del header.
export default function CartDrawer() {
  const { items, subtotal, cantidadTotal, setCantidad, quitar, agregar, drawerAbierto, cerrarDrawer } =
    useCart()
  // "Completá tu compra": hasta 2 productos de la misma línea o categoría que
  // lo del carrito, con la lista que ya trajo el muestrario (sin otro pedido).
  const idsEnCarrito = items.map((i) => i.id).join(',')
  const sugeridos = useMemo(
    () => (drawerAbierto ? sugerenciasCarrito(idsEnCarrito.split(','), productosEnCache()) : []),
    [drawerAbierto, idsEnCarrito],
  )
  const navigate = useNavigate()
  const panelRef = useRef<HTMLElement>(null)
  const cerrarRef = useRef<HTMLButtonElement>(null)
  // El efecto de foco depende solo de abierto/cerrado: si se volviera a correr
  // al cambiar el carrito, movería el foco en cada toque de +/−.
  const cerrarDrawerRef = useRef(cerrarDrawer)
  cerrarDrawerRef.current = cerrarDrawer

  // Cerrado sigue en el DOM (por la animación): que no se pueda enfocar con
  // Tab ni lo lea un lector de pantalla. (React 18 no conoce la prop inert.)
  useEffect(() => {
    if (panelRef.current) panelRef.current.inert = !drawerAbierto
  }, [drawerAbierto])

  // Bloqueamos el scroll del fondo y permitimos cerrar con Escape mientras está
  // abierto. Para teclado y lectores de pantalla: el foco entra al carrito al
  // abrir, Tab no se escapa a la página de atrás, y al cerrar vuelve a donde
  // estaba (ej. el botón "Agregar al carrito").
  useEffect(() => {
    if (!drawerAbierto) return
    const anterior = document.activeElement as HTMLElement | null
    cerrarRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return cerrarDrawerRef.current()
      if (e.key !== 'Tab' || !panelRef.current) return
      const enfocables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea',
      )
      if (enfocables.length === 0) return
      const primero = enfocables[0]
      const ultimo = enfocables[enfocables.length - 1]
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primero.focus()
      }
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
      anterior?.focus?.({ preventScroll: true })
    }
  }, [drawerAbierto])

  function irA(ruta: string) {
    cerrarDrawer()
    navigate(ruta)
  }

  return (
    <div className={drawerAbierto ? 'drawer-overlay open' : 'drawer-overlay'} onClick={cerrarDrawer}>
      <aside
        ref={panelRef}
        className={drawerAbierto ? 'drawer open' : 'drawer'}
        onClick={(e) => e.stopPropagation()}
        aria-hidden={!drawerAbierto}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-titulo"
      >
        <header className="drawer-head">
          <h2 id="drawer-titulo">
            Tu carrito {cantidadTotal > 0 && <span>({cantidadTotal})</span>}
          </h2>
          <button ref={cerrarRef} className="drawer-close" onClick={cerrarDrawer} aria-label="Cerrar el carrito">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        {items.length === 0 ? (
          <div className="drawer-empty">
            <p>Tu carrito está vacío.</p>
            <button className="btn btn-primary" onClick={() => irA('/')}>
              Ver el muestrario
            </button>
          </div>
        ) : (
          <>
            <div className="drawer-items">
              {items.map((i) => (
                <div className="drawer-item" key={claveItem(i)}>
                  <Miniatura src={i.imagen} alt={i.nombre} width={68} height={68} />
                  <div className="drawer-item-main">
                    <p className="drawer-item-name">{nombreConTalle(i)}</p>
                    <p className="drawer-item-price">{money(i.precio)}</p>
                    <div className="qty qty-sm">
                      <button
                        type="button"
                        onClick={() => setCantidad(claveItem(i), i.cantidad - 1)}
                        aria-label={`Restar una unidad de ${i.nombre}`}
                        disabled={i.cantidad <= 1}
                      >
                        −
                      </button>
                      <span aria-live="polite">{i.cantidad}</span>
                      <button
                        type="button"
                        onClick={() => setCantidad(claveItem(i), i.cantidad + 1)}
                        aria-label={`Sumar una unidad de ${i.nombre}`}
                        disabled={i.cantidad >= maximoPedible(i)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="drawer-item-right">
                    <span className="drawer-item-total">{money(i.precio * i.cantidad)}</span>
                    <button
                      className="drawer-remove"
                      onClick={() => quitar(claveItem(i))}
                      aria-label={`Quitar ${i.nombre} del carrito`}
                      title="Quitar"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}

              {sugeridos.length > 0 && (
                <section className="drawer-sugeridos" aria-labelledby="drawer-sugeridos-titulo">
                  <h3 id="drawer-sugeridos-titulo">Completá tu compra</h3>
                  {sugeridos.map((p) => (
                    <div className="drawer-sugerido" key={p.id}>
                      <Miniatura src={portadaDe(p)} alt="" width={52} height={52} />
                      <div className="drawer-sugerido-info">
                        <button
                          type="button"
                          className="drawer-sugerido-nombre"
                          onClick={() => irA(`/producto/${p.slug ?? p.id}`)}
                        >
                          {p.nombre}
                        </button>
                        <span>{money(p.precio)}</span>
                      </div>
                      <button
                        type="button"
                        className="drawer-sugerido-agregar"
                        onClick={() => agregar(p)}
                        aria-label={`Agregar ${p.nombre} al carrito`}
                      >
                        + Agregar
                      </button>
                    </div>
                  ))}
                </section>
              )}
            </div>

            <footer className="drawer-foot">
              <div className="drawer-subtotal">
                <span>Subtotal</span>
                <strong>{money(subtotal)}</strong>
              </div>
              <p className="drawer-nota">El envío se calcula en el siguiente paso. El pago lo coordinamos por WhatsApp.</p>
              <button className="btn btn-primary" onClick={() => irA('/checkout')}>
                Finalizar compra · {money(subtotal)}
              </button>
              <button className="drawer-seguir" onClick={cerrarDrawer}>
                Seguir comprando
              </button>
            </footer>
          </>
        )}
      </aside>
    </div>
  )
}
