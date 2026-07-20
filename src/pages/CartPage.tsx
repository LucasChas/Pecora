import { Link } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import HeaderActions from '../components/account/HeaderActions'
import { useCart } from '../context/CartContext'
import { money } from '../lib/format'
import { waPedidoLink } from '../lib/config'
import '../styles/catalog.css'
import '../styles/cart.css'

// Página del carrito (/carrito): lista de ítems, cantidades, subtotal y cierre.
// Por ahora el cierre es por WhatsApp (arma el pedido); el checkout completo
// con datos, MercadoPago y envío llega en las próximas fases.
export default function CartPage() {
  const { items, subtotal, setCantidad, quitar, vaciar } = useCart()

  return (
    <div className="catalog-root">
      <header className="cart-header">
        <Link to="/">
          <Logo />
        </Link>
        <HeaderActions />
      </header>
      <Scallop />

      <main className="cart-page">
        <h1 className="cart-title">Tu carrito</h1>

        {items.length === 0 ? (
          <div className="no-results">
            Tu carrito está vacío.
            <br />
            <Link className="pp-back" to="/">
              ← Volver al muestrario
            </Link>
          </div>
        ) : (
          <>
            <div className="cart-list">
              {items.map((i) => (
                <div className="cart-item" key={i.id}>
                  <img src={i.imagen} alt={i.nombre} />
                  <div className="cart-item-main">
                    <Link to={`/producto/${i.id}`} className="cart-item-name">
                      {i.nombre}
                    </Link>
                    <p className="cart-item-price">{money(i.precio)}</p>
                    <div className="qty">
                      <button type="button" onClick={() => setCantidad(i.id, i.cantidad - 1)} aria-label="Restar">
                        −
                      </button>
                      <span>{i.cantidad}</span>
                      <button type="button" onClick={() => setCantidad(i.id, i.cantidad + 1)} aria-label="Sumar">
                        +
                      </button>
                    </div>
                  </div>
                  <div className="cart-item-right">
                    <p className="cart-item-total">{money(i.precio * i.cantidad)}</p>
                    <button type="button" className="cart-remove" onClick={() => quitar(i.id)}>
                      Quitar
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="cart-summary">
              <div className="cart-subtotal">
                <span>Subtotal</span>
                <strong>{money(subtotal)}</strong>
              </div>
              <p className="cart-note">
                En el siguiente paso cargás tus datos y la entrega. El pago online
                llega pronto; por ahora se coordina por WhatsApp.
              </p>

              <Link className="btn btn-primary" to="/checkout">
                Finalizar pedido
              </Link>
              <a
                className="cart-wa-express"
                href={waPedidoLink(items, subtotal)}
                target="_blank"
                rel="noopener noreferrer"
              >
                o cerralo rápido por WhatsApp (sin formulario)
              </a>
              <div className="cart-actions">
                <Link className="pp-back" to="/">
                  ← Seguir comprando
                </Link>
                <button type="button" className="cart-clear" onClick={vaciar}>
                  Vaciar carrito
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
