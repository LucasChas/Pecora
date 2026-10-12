import { Link } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import HeaderActions from '../components/account/HeaderActions'
import { claveItem, maximoPedible, nombreConTalle, useCart } from '../context/CartContext'
import { money } from '../lib/format'
import { useDialog } from '../context/DialogContext'
import Miniatura from '../components/common/Miniatura'
import '../styles/catalog.css'
import '../styles/cart.css'
import { useTitulo } from '../hooks/useTitulo'

// Página del carrito (/carrito): lista de ítems, cantidades, subtotal y cierre.
// Por ahora el cierre es por WhatsApp (arma el pedido); el checkout completo
// con datos, MercadoPago y envío llega en las próximas fases.
export default function CartPage() {
  const { items, subtotal, setCantidad, quitar, vaciar } = useCart()
  useTitulo('Tu carrito')
  const { confirmar } = useDialog()

  // Vaciar no tiene vuelta atrás: se pregunta antes.
  async function confirmarVaciar() {
    const ok = await confirmar({
      titulo: '¿Vaciar el carrito?',
      mensaje: 'Se quitan todos los productos.',
      textoOk: 'Vaciar',
      textoCancelar: 'No, dejarlo',
      peligro: true,
    })
    if (ok) vaciar()
  }

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
                <div className="cart-item" key={claveItem(i)}>
                  <Miniatura src={i.imagen} alt={i.nombre} width={84} height={84} />
                  <div className="cart-item-main">
                    <Link to={`/producto/${i.slug ?? i.id}`} className="cart-item-name">
                      {nombreConTalle(i)}
                    </Link>
                    <p className="cart-item-price">{money(i.precio)}</p>
                    <div className="qty">
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
                  <div className="cart-item-right">
                    <p className="cart-item-total">{money(i.precio * i.cantidad)}</p>
                    <button type="button" className="cart-remove" onClick={() => quitar(claveItem(i))}>
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
              {/* TODO(owner-copy): revisar este texto una vez definida la copy final del checkout. */}
              <p className="cart-note">
                En el siguiente paso cargás tus datos y la entrega. El pago (efectivo o
                transferencia) y el envío los coordinamos por WhatsApp.
              </p>

              <Link className="btn btn-primary" to="/checkout">
                Finalizar compra
              </Link>
              <div className="cart-actions">
                <Link className="pp-back" to="/">
                  ← Seguir comprando
                </Link>
                <button type="button" className="cart-clear" onClick={() => void confirmarVaciar()}>
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
