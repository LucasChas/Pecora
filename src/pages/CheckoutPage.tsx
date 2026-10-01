import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import { useCart, type CartItem } from '../context/CartContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { money } from '../lib/format'
import { waPedidoConfirmadoLink, type DatosPedido } from '../lib/config'
import {
  PROVINCIAS_AR,
  calcularSubtotal,
  crearPedido,
  detalleDe,
  leerPedidoCreado,
  nuevaClaveIdempotencia,
  totalesDe,
  type DetallePedido,
  type TotalesPedido,
} from '../lib/orders'
import { validarCupon, type ResultadoCupon } from '../lib/cupones'
import {
  ENVIO_A_COORDINAR,
  cotizarEnvio,
  puedeCotizar,
  textoCotizacion,
  type CotizacionEnvio,
} from '../lib/envios'
import OrderSuccess from '../components/cart/OrderSuccess'
import '../styles/catalog.css'
import '../styles/cart.css'

interface PedidoConfirmado {
  numero: number
  items: CartItem[]
  totales: TotalesPedido
  datos: DatosPedido
  detalle: DetallePedido
}

// Cupón aplicado y el subtotal contra el que se validó (si el carrito cambia,
// se vuelve a validar).
interface CuponAplicado {
  resultado: ResultadoCupon
  subtotal: number
}

// Espera antes de cotizar el envío mientras la clienta escribe el CP.
const DEBOUNCE_COTIZACION_MS = 400

type MetodoPago = 'whatsapp' | 'mercadopago'

// Checkout como INVITADA (/checkout): datos de contacto y entrega, cupón,
// cotización del envío, método de pago, revalidación de stock/precios contra
// la base y registro del pedido.
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
  const [provincia, setProvincia] = useState('')
  const [notas, setNotas] = useState('')
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('whatsapp')

  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmado, setConfirmado] = useState<PedidoConfirmado | null>(null)

  // ---- Cupón ----
  const [cuponInput, setCuponInput] = useState('')
  const [cupon, setCupon] = useState<CuponAplicado | null>(null)
  const [validandoCupon, setValidandoCupon] = useState(false)
  const [mensajeCupon, setMensajeCupon] = useState<string | null>(null)

  // ---- Cotización del envío ----
  const [cotizacion, setCotizacion] = useState<CotizacionEnvio | null>(null)
  const [cotizando, setCotizando] = useState(false)

  // Clave de idempotencia del intento de compra: se mantiene en los reintentos
  // (ej. tras un corte de red, si la base ya registró el pedido devuelve el
  // mismo número en vez de duplicarlo) y se renueva cuando cambia el carrito,
  // el cupón o la entrega/destino (es otro pedido), y después de un pedido
  // confirmado.
  const claveRef = useRef<string | null>(null)
  const firmaCarrito = items.map((i) => `${i.id}:${i.cantidad}:${i.precio}`).join('|')
  const codigoCupon = cupon?.resultado.codigo ?? ''
  const firmaIntento = [firmaCarrito, codigoCupon, entrega, provincia, cp.trim()].join('#')
  useEffect(() => {
    claveRef.current = null
  }, [firmaIntento])

  function claveIdempotencia(): string {
    if (!claveRef.current) claveRef.current = nuevaClaveIdempotencia()
    return claveRef.current
  }

  // Cotiza el envío cuando hay provincia o CP (con debounce). Si una respuesta
  // llega tarde (la clienta siguió escribiendo), se descarta.
  const destinoCotizable = entrega === 'envio' && puedeCotizar(provincia, cp)
  useEffect(() => {
    if (!destinoCotizable) {
      setCotizacion(null)
      setCotizando(false)
      return
    }
    let vigente = true
    setCotizando(true)
    const t = window.setTimeout(() => {
      cotizarEnvio(provincia, cp, subtotal).then((c) => {
        if (!vigente) return
        setCotizacion(c)
        setCotizando(false)
      })
    }, DEBOUNCE_COTIZACION_MS)
    return () => {
      vigente = false
      window.clearTimeout(t)
    }
  }, [destinoCotizable, provincia, cp, subtotal])

  // Si el subtotal cambia con un cupón aplicado (ej. la revalidación ajustó el
  // carrito), se vuelve a validar: puede dejar de cumplir el mínimo.
  useEffect(() => {
    if (!cupon || cupon.subtotal === subtotal || subtotal <= 0) return
    let vigente = true
    validarCupon(cupon.resultado.codigo, subtotal).then((r) => {
      if (!vigente) return
      if (r.valido) {
        setCupon({ resultado: r, subtotal })
      } else {
        setCupon(null)
        setCuponInput(cupon.resultado.codigo)
        setMensajeCupon(r.mensaje)
      }
    })
    return () => {
      vigente = false
    }
  }, [cupon, subtotal])

  async function aplicarCupon() {
    if (validandoCupon || cuponInput.trim() === '') return
    setValidandoCupon(true)
    setMensajeCupon(null)
    const r = await validarCupon(cuponInput, subtotal)
    setValidandoCupon(false)
    if (r.valido) {
      setCupon({ resultado: r, subtotal })
      setCuponInput('')
    } else {
      setMensajeCupon(r.mensaje)
    }
  }

  function quitarCupon() {
    setCupon(null)
    setMensajeCupon(null)
  }

  // ---- Estimación de totales (la base recalcula todo al registrar) ----
  const esEnvio = entrega === 'envio'
  const envioConZona = esEnvio && !cotizando && cotizacion?.disponible === true
  const envioGratisCupon = cupon?.resultado.envioGratis === true
  const descuentoEstimado = cupon?.resultado.descuento ?? 0
  const costoEnvioEstimado =
    envioConZona && !envioGratisCupon && cotizacion ? cotizacion.costo : 0
  const totales = totalesDe({
    subtotal,
    descuento: Math.min(descuentoEstimado, subtotal),
    costo_envio: costoEnvioEstimado,
  })
  const zonaEstimada = envioConZona ? cotizacion?.zonaNombre ?? null : null
  const textoEnvioResumen = !esEnvio
    ? 'Sin costo'
    : cotizando
      ? 'Calculando…'
      : envioConZona && envioGratisCupon
        ? 'Gratis'
        : textoCotizacion(cotizacion ?? ENVIO_A_COORDINAR)
  const envioACoordinar = esEnvio && !cotizando && !envioConZona
  const hayEstimacion = totales.descuento > 0 || envioConZona

  // Texto bajo los campos de dirección: cómo va la cotización del envío.
  let textoCotizando: string
  if (!destinoCotizable) {
    textoCotizando = 'Elegí la provincia o cargá el código postal para calcular el envío.'
  } else if (cotizando) {
    textoCotizando = 'Calculando el envío…'
  } else if (envioConZona && cotizacion) {
    const zona = cotizacion.zonaNombre ? ` (${cotizacion.zonaNombre})` : ''
    textoCotizando = `Envío${zona}: ${envioGratisCupon ? 'gratis con tu cupón' : textoCotizacion(cotizacion)}`
  } else {
    textoCotizando =
      cotizacion?.mensaje ??
      'No tenemos una tarifa fija para ese destino: el costo del envío se coordina al confirmar el pedido.'
  }

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
        cambios.push(
          actual.stock === 1
            ? `"${item.nombre}": queda 1 unidad (ajustamos la cantidad).`
            : `"${item.nombre}": quedan ${actual.stock} unidades (ajustamos la cantidad).`,
        )
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

      const envio = entrega === 'envio'
      const datos: DatosPedido = {
        nombre,
        entrega,
        direccion: envio ? direccion : undefined,
        localidad: envio ? localidad : undefined,
        cp: envio ? cp : undefined,
        provincia: envio && provincia ? provincia : undefined,
        notas: notas || undefined,
      }
      // crear_pedido (SECURITY DEFINER) registra el pedido y devuelve el número
      // de orden, sin exponer la lectura de pedidos (ver lib/orders). La base
      // valida el cupón y calcula el descuento y el costo del envío.
      const numero = await crearPedido({
        datos: { ...datos, telefono, email },
        items: corregidos,
        idempotencyKey: claveIdempotencia(),
        cupon: codigoCupon || null,
      })
      claveRef.current = null

      // Totales definitivos: los que guardó la base. Si no se pueden leer, la
      // estimación que la clienta vio en el resumen.
      const creado = session ? await leerPedidoCreado(numero, session.user.id) : null
      const subtotalFinal = calcularSubtotal(corregidos)
      const totalesFinales = creado
        ? totalesDe(creado)
        : totalesDe({
            subtotal: subtotalFinal,
            descuento: Math.min(descuentoEstimado, subtotalFinal),
            costo_envio: costoEnvioEstimado,
          })
      // Cupón y zona: los de la base si ya tiene esas columnas.
      const delServidor = creado ? detalleDe(creado) : null
      const detalle: DetallePedido = {
        cupon: creado && creado.cupon_codigo !== undefined ? delServidor?.cupon : codigoCupon || null,
        zona: !envio
          ? null
          : creado && creado.zona_nombre !== undefined
            ? delServidor?.zona
            : zonaEstimada,
      }

      // TODO (fase MercadoPago): si metodoPago === 'mercadopago', acá se llama a
      // la Edge Function que crea la preferencia y se redirige al checkout de MP.
      setConfirmado({
        numero,
        items: corregidos,
        totales: totalesFinales,
        datos: { ...datos, cupon: detalle.cupon ?? undefined, zona: detalle.zona ?? undefined },
        detalle,
      })
      vaciar()
    } catch (err) {
      // crear_pedido devuelve mensajes ya redactados para la clienta (falta de
      // stock, carrito vacío, cupón vencido…), así que los mostramos tal cual.
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos registrar el pedido. Probá de nuevo en un momento.',
      )
    } finally {
      setEnviando(false)
    }
  }

  // Para comprar hay que estar logueada: si no, va a /cuenta y vuelve al checkout.
  if (cargandoSesion) {
    return (
      <div className="catalog-root">
        <div className="loading-state">
          <span className="loading-spinner" aria-hidden="true" />
          Cargando…
        </div>
      </div>
    )
  }
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
        {confirmado ? null : items.length === 0 ? (
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
                    <input type="text" required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Ana Pérez" autoComplete="name" />
                  </div>
                  <div className="field">
                    <label>Teléfono (WhatsApp)</label>
                    <input type="tel" required value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Ej: 3541 123456" autoComplete="tel" />
                  </div>
                  <div className="field">
                    <label>Email (opcional)</label>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" autoComplete="email" />
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
                        <input type="text" required value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Calle y número" autoComplete="street-address" />
                      </div>
                      <div className="row2">
                        <div className="field">
                          <label>Localidad</label>
                          <input type="text" required value={localidad} onChange={(e) => setLocalidad(e.target.value)} placeholder="Ciudad" autoComplete="address-level2" />
                        </div>
                        <div className="field">
                          <label>Código postal</label>
                          <input type="text" required value={cp} onChange={(e) => setCp(e.target.value)} placeholder="CP" autoComplete="postal-code" inputMode="numeric" />
                        </div>
                      </div>
                      <div className="field">
                        <label htmlFor="checkout-provincia">Provincia</label>
                        <select id="checkout-provincia" value={provincia} onChange={(e) => setProvincia(e.target.value)} autoComplete="address-level1">
                          <option value="">Elegí una provincia</option>
                          {PROVINCIAS_AR.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </div>
                      <p
                        className={envioConZona ? 'cart-note envio-cotizacion envio-cotizacion--ok' : 'cart-note envio-cotizacion'}
                        aria-live="polite"
                      >
                        {textoCotizando}
                      </p>
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

                <button type="submit" className="btn btn-primary" disabled={enviando || validandoCupon}>
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

                  {/* Cupón: fuera del <form> para que Enter aplique el cupón
                      y no confirme el pedido. */}
                  <div className="cupon-box">
                    {cupon ? (
                      <div className="cupon-aplicado">
                        <span className="cupon-chip">{cupon.resultado.codigo}</span>
                        <span className="cupon-desc">
                          {cupon.resultado.envioGratis && cupon.resultado.descuento <= 0
                            ? 'Envío gratis'
                            : `− ${money(cupon.resultado.descuento)}`}
                        </span>
                        <button
                          type="button"
                          className="cupon-quitar"
                          onClick={quitarCupon}
                          aria-label={`Quitar el cupón ${cupon.resultado.codigo}`}
                        >
                          Quitar
                        </button>
                      </div>
                    ) : (
                      <>
                        <label className="cupon-label" htmlFor="checkout-cupon">
                          ¿Tenés un cupón?
                        </label>
                        <div className="cupon-fila">
                          <input
                            id="checkout-cupon"
                            type="text"
                            value={cuponInput}
                            onChange={(e) => {
                              setCuponInput(e.target.value)
                              setMensajeCupon(null)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                aplicarCupon()
                              }
                            }}
                            placeholder="Código"
                            autoComplete="off"
                            autoCapitalize="characters"
                            spellCheck={false}
                            aria-invalid={mensajeCupon ? true : undefined}
                            aria-describedby={mensajeCupon ? 'checkout-cupon-msg' : undefined}
                          />
                          <button
                            type="button"
                            className="cupon-aplicar"
                            onClick={aplicarCupon}
                            disabled={validandoCupon || cuponInput.trim() === ''}
                          >
                            {validandoCupon ? 'Validando…' : 'Aplicar'}
                          </button>
                        </div>
                      </>
                    )}
                    <p id="checkout-cupon-msg" className="cupon-msg" role="status">
                      {mensajeCupon ?? cupon?.resultado.mensaje ?? ''}
                    </p>
                  </div>

                  <div className="summary-linea">
                    <span>Subtotal</span>
                    <span>{money(totales.subtotal)}</span>
                  </div>
                  {totales.descuento > 0 && (
                    <div className="summary-linea summary-descuento">
                      <span>Descuento ({codigoCupon})</span>
                      <span>− {money(totales.descuento)}</span>
                    </div>
                  )}
                  <div className="summary-linea muted">
                    <span>Envío{zonaEstimada ? ` (${zonaEstimada})` : ''}</span>
                    <span>{textoEnvioResumen}</span>
                  </div>
                  <div className="summary-linea total">
                    <span>{hayEstimacion ? 'Total estimado' : 'Total'}</span>
                    <strong>{money(totales.total)}</strong>
                  </div>
                  {envioACoordinar && (
                    <p className="summary-nota">El costo del envío se suma al coordinarlo.</p>
                  )}
                  {hayEstimacion && (
                    <p className="summary-nota">El total final se confirma al registrar el pedido.</p>
                  )}
                </div>
              </aside>
            </div>
          </>
        )}
      </main>

      {/* Modal de éxito */}
      {confirmado && (
        <OrderSuccess
          items={confirmado.items}
          totales={confirmado.totales}
          detalle={confirmado.detalle}
          entrega={confirmado.datos.entrega}
          waHref={waPedidoConfirmadoLink(
            confirmado.numero,
            confirmado.items,
            confirmado.totales,
            confirmado.datos,
          )}
        />
      )}
    </div>
  )
}
