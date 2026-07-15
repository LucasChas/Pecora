import { useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import { useCart, type CartItem } from '../context/CartContext'
import { supabase } from '../lib/supabaseClient'
import { money } from '../lib/format'
import { waPedidoConfirmadoLink, type DatosPedido } from '../lib/config'
import '../styles/catalog.css'
import '../styles/cart.css'

// Pedido ya confirmado (para la pantalla de éxito, después de vaciar el carrito).
interface PedidoConfirmado {
  numero: number
  items: CartItem[]
  subtotal: number
  datos: DatosPedido
}

// Checkout como INVITADA (/checkout): datos de contacto y entrega, revalidación
// de stock/precios contra la base, y registro del pedido en la tabla "pedidos".
// El pago online (MercadoPago) y el cálculo de envío se enchufan acá más adelante.
export default function CheckoutPage() {
  const { items, subtotal, reemplazar, vaciar } = useCart()

  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [entrega, setEntrega] = useState<'coordinar' | 'envio'>('coordinar')
  const [direccion, setDireccion] = useState('')
  const [localidad, setLocalidad] = useState('')
  const [cp, setCp] = useState('')
  const [notas, setNotas] = useState('')

  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmado, setConfirmado] = useState<PedidoConfirmado | null>(null)

  // Revalida el carrito contra la base: precios vigentes y stock disponible.
  // Devuelve los ítems corregidos y una lista de cambios (vacía si está todo ok).
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
      // 1) Revalidamos contra la base antes de registrar nada.
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

      // 2) Registramos el pedido.
      const datos: DatosPedido = {
        nombre,
        entrega,
        direccion: entrega === 'envio' ? direccion : undefined,
        localidad: entrega === 'envio' ? localidad : undefined,
        cp: entrega === 'envio' ? cp : undefined,
        notas: notas || undefined,
      }
      const subtotalFinal = corregidos.reduce((n, i) => n + i.precio * i.cantidad, 0)
      const { data, error } = await supabase
        .from('pedidos')
        .insert({
          nombre,
          telefono,
          email: email || null,
          entrega,
          direccion: datos.direccion ?? null,
          localidad: datos.localidad ?? null,
          cp: datos.cp ?? null,
          notas: datos.notas ?? null,
          items: corregidos.map((i) => ({
            id: i.id,
            nombre: i.nombre,
            precio: i.precio,
            cantidad: i.cantidad,
          })),
          subtotal: subtotalFinal,
        })
        .select('numero')
        .single()
      if (error) throw new Error(error.message)

      // 3) Éxito: guardamos la copia local para la pantalla final y vaciamos.
      setConfirmado({ numero: data.numero, items: corregidos, subtotal: subtotalFinal, datos })
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

  return (
    <div className="catalog-root">
      <header className="cart-header">
        <Link to="/">
          <Logo />
        </Link>
      </header>
      <Scallop />

      <main className="cart-page">
        {/* ---------- Pantalla de éxito ---------- */}
        {confirmado ? (
          <div className="checkout-ok">
            <h1 className="cart-title">¡Pedido #{confirmado.numero} registrado! 🎉</h1>
            <p className="cart-note">
              Guardamos tu pedido. Para confirmarlo y coordinar
              {confirmado.datos.entrega === 'envio' ? ' el pago y el envío' : ' el pago y la entrega'},
              envianos el detalle por WhatsApp con un toque:
            </p>
            <a
              className="btn btn-primary"
              href={waPedidoConfirmadoLink(
                confirmado.numero,
                confirmado.items,
                confirmado.subtotal,
                confirmado.datos,
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              Enviar pedido #{confirmado.numero} por WhatsApp
            </a>
            <Link className="pp-back" to="/">
              ← Volver al muestrario
            </Link>
          </div>
        ) : items.length === 0 ? (
          /* ---------- Carrito vacío ---------- */
          <div className="no-results">
            Tu carrito está vacío.
            <br />
            <Link className="pp-back" to="/">
              ← Volver al muestrario
            </Link>
          </div>
        ) : (
          /* ---------- Formulario ---------- */
          <>
            <h1 className="cart-title">Finalizar pedido</h1>

            {/* Resumen compacto */}
            <div className="checkout-resumen">
              {items.map((i) => (
                <div className="checkout-linea" key={i.id}>
                  <span>
                    {i.cantidad}x {i.nombre}
                  </span>
                  <span>{money(i.precio * i.cantidad)}</span>
                </div>
              ))}
              <div className="checkout-linea total">
                <span>Subtotal</span>
                <strong>{money(subtotal)}</strong>
              </div>
            </div>

            <form onSubmit={onSubmit} className="checkout-form">
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

              <div className="field">
                <label>Entrega</label>
                <div className="entrega-opciones">
                  <label className={entrega === 'coordinar' ? 'entrega-op active' : 'entrega-op'}>
                    <input
                      type="radio"
                      name="entrega"
                      checked={entrega === 'coordinar'}
                      onChange={() => setEntrega('coordinar')}
                    />
                    Retiro / a coordinar
                  </label>
                  <label className={entrega === 'envio' ? 'entrega-op active' : 'entrega-op'}>
                    <input
                      type="radio"
                      name="entrega"
                      checked={entrega === 'envio'}
                      onChange={() => setEntrega('envio')}
                    />
                    Envío a domicilio
                  </label>
                </div>
              </div>

              {entrega === 'envio' && (
                <>
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
                  <p className="cart-note">
                    El costo del envío se coordina por WhatsApp al confirmar el pedido.
                  </p>
                </>
              )}

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
          </>
        )}
      </main>
    </div>
  )
}
