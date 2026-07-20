import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import { useCart, type CartItem } from '../context/CartContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { money } from '../lib/format'
import { waPedidoConfirmadoLink, type DatosPedido } from '../lib/config'
import OrderSuccess from '../components/cart/OrderSuccess'
import '../styles/catalog.css'
import '../styles/cart.css'

interface PedidoConfirmado {
  numero: number
  items: CartItem[]
  subtotal: number
  datos: DatosPedido
}

type MetodoPago = 'whatsapp' | 'mercadopago'

// Checkout como INVITADA (/checkout): datos de contacto y entrega, método de
// pago, revalidación de stock/precios contra la base y registro del pedido.
export default function CheckoutPage() {
  const { items, subtotal, reemplazar, vaciar } = useCart()
  const { session, perfil, loading: cargandoSesion } = useAuth()

  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [entrega, setEntrega] = useState<'coordinar' | 'envio'>('coordinar')
  const [direccion, setDireccion] = useState('')
  const [localidad, setLocalidad] = useState('')
  const [cp, setCp] = useState('')
  const [notas, setNotas] = useState('')
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('whatsapp')

  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmado, setConfirmado] = useState<PedidoConfirmado | null>(null)

  // Prefill de nombre/teléfono con los datos de la cuenta (si están cargados).
  useEffect(() => {
    if (!perfil) return
    setNombre((n) => n || perfil.nombre || '')
    setTelefono((t) => t || perfil.telefono || '')
  }, [perfil])

  // Revalida el carrito contra la base: precios vigentes y stock disponible.
  async function revalidarCarrito(): Promise<{ corregidos: CartItem[]; cambios: string[] }> {
    const ids = items.map((i) => i.id)
    const { data, error } = await supabase
      .from('productos')
      .select('id, nombre, precio, stock')
      .in('id', ids)
    if (error) throw new Error(error.message)

    const porId = new Map((data ?? []).map((p) => [p.id, p]))
    const cambios: string[] = []
    const corregidos: CartItem[] = []

    for (const item of items) {
      const actual = porId.get(item.id)
      if (!actual || actual.stock <= 0) {
        cambios.push(`"${item.nombre}" ya no está disponible y se quitó del carrito.`)
        continue
      }
      let cantidad = item.cantidad
      if (cantidad > actual.stock) {
        cantidad = actual.stock
        cambios.push(`"${item.nombre}": quedan ${actual.stock} unidades (ajustamos la cantidad).`)
      }
      if (actual.precio !== item.precio) {
        cambios.push(`"${item.nombre}": el precio se actualizó a ${money(actual.precio)}.`)
      }
      corregidos.push({ ...item, precio: actual.precio, stock: actual.stock, cantidad })
    }
    return { corregidos, cambios }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setAviso(null)
    setEnviando(true)
    try {
      const { corregidos, cambios } = await revalidarCarrito()
      if (cambios.length > 0) {
        reemplazar(corregidos)
        setAviso(
          'Actualizamos tu carrito con los datos vigentes:\n• ' +
            cambios.join('\n• ') +
            '\nRevisá el resumen y volvé a confirmar.',
        )
        return
      }
      if (corregidos.length === 0) {
        setError('Tu carrito quedó vacío.')
        return
      }

      const datos: DatosPedido = {
        nombre,
        entrega,
        direccion: entrega === 'envio' ? direccion : undefined,
        localidad: entrega === 'envio' ? localidad : undefined,
        cp: entrega === 'envio' ? cp : undefined,
        notas: notas || undefined,
      }
      const subtotalFinal = corregidos.reduce((n, i) => n + i.precio * i.cantidad, 0)
      // Usamos la función crear_pedido (SECURITY DEFINER): registra el pedido y
      // nos devuelve el número de orden, sin exponer la lectura de pedidos.
      const { data: numero, error } = await supabase.rpc('crear_pedido', {
        p_nombre: nombre,
        p_telefono: telefono,
        p_email: email || null,
        p_entrega: entrega,
        p_direccion: datos.direccion ?? null,
        p_localidad: datos.localidad ?? null,
        p_cp: datos.cp ?? null,
        p_notas: datos.notas ?? null,
        p_items: corregidos.map((i) => ({
          id: i.id,
          nombre: i.nombre,
          precio: i.precio,
          cantidad: i.cantidad,
        })),
        p_subtotal: subtotalFinal,
      })
      if (error) throw new Error(error.message)

      // TODO (fase MercadoPago): si metodoPago === 'mercadopago', acá se llama a
      // la Edge Function que crea la preferencia y se redirige al checkout de MP.
      setConfirmado({ numero: numero as number, items: corregidos, subtotal: subtotalFinal, datos })
      vaciar()
    } catch (err) {
      setError(
        'No pudimos registrar el pedido: ' +
          (err instanceof Error ? err.message : String(err)),
      )
    } finally {
      setEnviando(false)
    }
  }

  // Para comprar hay que estar logueada: si no, va a /cuenta y vuelve al checkout.
  if (cargandoSesion) return null
  if (!session) return <Navigate to="/cuenta?next=/checkout" replace />

  return (
    <div className="catalog-root">
      <header className="cart-header">
        <Link to="/">
          <Logo />
        </Link>
      </header>
      <Scallop />

      <main className="checkout">
        {confirmado ? (
          <div className="no-results">Pedido registrado ✓</div>
        ) : items.length === 0 ? (
          <div className="no-results">
            Tu carrito está vacío.
            <br />
            <Link className="pp-back" to="/">
              ← Volver al muestrario
            </Link>
          </div>
        ) : (
          <>
            <h1 className="cart-title">Finalizar compra</h1>

            <div className="checkout-grid">
              {/* ---------- Columna formulario ---------- */}
              <form onSubmit={onSubmit} className="checkout-col-form checkout-form">
                <section className="checkout-card">
                  <h2 className="checkout-h">
                    <span className="paso">1</span> Tus datos
                  </h2>
                  <div className="field">
                    <label>Nombre y apellido</label>
                    <input type="text" required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Ana Pérez" />
                  </div>
                  <div className="field">
                    <label>Teléfono (WhatsApp)</label>
                    <input type="tel" required value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Ej: 3541 123456" />
                  </div>
                  <div className="field">
                    <label>Email (opcional)</label>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" />
                  </div>
                </section>

                <section className="checkout-card">
                  <h2 className="checkout-h">
                    <span className="paso">2</span> Entrega
                  </h2>
                  <div className="entrega-opciones">
                    <label className={entrega === 'coordinar' ? 'entrega-op active' : 'entrega-op'}>
                      <input type="radio" name="entrega" checked={entrega === 'coordinar'} onChange={() => setEntrega('coordinar')} />
                      Retiro / a coordinar
                    </label>
                    <label className={entrega === 'envio' ? 'entrega-op active' : 'entrega-op'}>
                      <input type="radio" name="entrega" checked={entrega === 'envio'} onChange={() => setEntrega('envio')} />
                      Envío a domicilio
                    </label>
                  </div>

                  {entrega === 'envio' && (
                    <div className="entrega-datos">
                      <div className="field">
                        <label>Dirección</label>
                        <input type="text" required value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Calle y número" />
                      </div>
                      <div className="row2">
                        <div className="field">
                          <label>Localidad</label>
                          <input type="text" required value={localidad} onChange={(e) => setLocalidad(e.target.value)} placeholder="Ciudad" />
                        </div>
                        <div className="field">
                          <label>Código postal</label>
                          <input type="text" required value={cp} onChange={(e) => setCp(e.target.value)} placeholder="CP" />
                        </div>
                      </div>
                      <p className="cart-note">El costo del envío se coordina al confirmar el pedido.</p>
                    </div>
                  )}
                </section>

                <section className="checkout-card">
                  <h2 className="checkout-h">
                    <span className="paso">3</span> Pago
                  </h2>
                  <div className="pago-opciones">
                    <label className={metodoPago === 'whatsapp' ? 'pago-op active' : 'pago-op'}>
                      <input type="radio" name="pago" checked={metodoPago === 'whatsapp'} onChange={() => setMetodoPago('whatsapp')} />
                      <div className="pago-txt">
                        <strong>Coordinar por WhatsApp</strong>
                        <span>Acordás el pago (efectivo, transferencia…) al confirmar el pedido.</span>
                      </div>
                    </label>
                    <label className="pago-op disabled" title="Lo activamos muy pronto">
                      <input type="radio" name="pago" disabled />
                      <div className="pago-txt">
                        <strong>
                          Pagar online <span className="badge-pronto">Muy pronto</span>
                        </strong>
                        <span>Con MercadoPago: tarjeta, débito o dinero en cuenta.</span>
                      </div>
                    </label>
                  </div>
                </section>

                <div className="field">
                  <label>Notas (opcional)</label>
                  <textarea value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Aclaraciones, horarios, etc." />
                </div>

                {aviso && <p className="checkout-aviso">{aviso}</p>}
                {error && <p className="form-error">{error}</p>}

                <button type="submit" className="btn btn-primary" disabled={enviando}>
                  {enviando ? 'Registrando…' : 'Confirmar pedido'}
                </button>
                <Link className="pp-back" to="/carrito">
                  ← Volver al carrito
                </Link>
              </form>

              {/* ---------- Columna resumen ---------- */}
              <aside className="checkout-col-summary">
                <div className="checkout-card summary-card">
                  <h2 className="checkout-h">Tu pedido</h2>
                  <div className="summary-items">
                    {items.map((i) => (
                      <div className="summary-item" key={i.id}>
                        <div className="summary-thumb">
                          <img src={i.imagen} alt={i.nombre} />
                          <span className="summary-qty">{i.cantidad}</span>
                        </div>
                        <span className="summary-name">{i.nombre}</span>
                        <span className="summary-total">{money(i.precio * i.cantidad)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="summary-linea">
                    <span>Subtotal</span>
                    <span>{money(subtotal)}</span>
                  </div>
                  <div className="summary-linea muted">
                    <span>Envío</span>
                    <span>a coordinar</span>
                  </div>
                  <div className="summary-linea total">
                    <span>Total</span>
                    <strong>{money(subtotal)}</strong>
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}
      </main>

      {/* Modal de éxito */}
      {confirmado && (
        <OrderSuccess
          numero={confirmado.numero}
          entrega={confirmado.datos.entrega}
          waHref={waPedidoConfirmadoLink(
            confirmado.numero,
            confirmado.items,
            confirmado.subtotal,
            confirmado.datos,
          )}
        />
      )}
    </div>
  )
}
