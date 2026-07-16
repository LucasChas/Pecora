import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCart } from '../../context/CartContext'
import { money } from '../../lib/format'

// Carrito lateral (drawer) que se desliza desde la derecha. Es la vista rápida
// del carrito: se abre al agregar un producto o al tocar el ícono del header.
export default function CartDrawer() {
  const { items, subtotal, cantidadTotal, setCantidad, quitar, drawerAbierto, cerrarDrawer } =
    useCart()
  const navigate = useNavigate()

  // Bloqueamos el scroll del fondo y permitimos cerrar con Escape mientras está abierto.
  useEffect(() => {
    if (!drawerAbierto) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cerrarDrawer()
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [drawerAbierto, cerrarDrawer])

  function irA(ruta: string) {
    cerrarDrawer()
    navigate(ruta)
  }

  return (
    <div className={drawerAbierto ? 'drawer-overlay open' : 'drawer-overlay'} onClick={cerrarDrawer}>
      <aside
        className={drawerAbierto ? 'drawer open' : 'drawer'}
        onClick={(e) => e.stopPropagation()}
        aria-hidden={!drawerAbierto}
      >
        <header className="drawer-head">
          <h2>
            Tu carrito {cantidadTotal > 0 && <span>({cantidadTotal})</span>}
          </h2>
          <button className="drawer-close" onClick={cerrarDrawer} aria-label="Cerrar">
            ✕
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
                <div className="drawer-item" key={i.id}>
                  <img src={i.imagen} alt={i.nombre} />
                  <div className="drawer-item-main">
                    <p className="drawer-item-name">{i.nombre}</p>
                    <p className="drawer-item-price">{money(i.precio)}</p>
                    <div className="qty qty-sm">
                      <button type="button" onClick={() => setCantidad(i.id, i.cantidad - 1)} aria-label="Restar">
                        −
                      </button>
                      <span>{i.cantidad}</span>
                      <button type="button" onClick={() => setCantidad(i.id, i.cantidad + 1)} aria-label="Sumar">
                        +
                      </button>
                    </div>
                  </div>
                  <div className="drawer-item-right">
                    <span className="drawer-item-total">{money(i.precio * i.cantidad)}</span>
                    <button className="drawer-remove" onClick={() => quitar(i.id)} aria-label="Quitar">
                      Quitar
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <footer className="drawer-foot">
              <div className="drawer-subtotal">
                <span>Subtotal</span>
                <strong>{money(subtotal)}</strong>
              </div>
              <p className="drawer-nota">Envío y pago se coordinan en el siguiente paso.</p>
              <button className="btn btn-primary" onClick={() => irA('/checkout')}>
                Finalizar compra
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
