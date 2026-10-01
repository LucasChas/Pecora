import { useEffect, useRef, useState } from 'react'
import type { EntregaPedido, ProductoConCategoria } from '../../types'
import { supabase } from '../../lib/supabaseClient'
import { money } from '../../lib/format'
import {
  PROVINCIAS_AR,
  calcularSubtotal,
  crearPedido,
  nuevaClaveIdempotencia,
} from '../../lib/orders'
import { validarCupon, type ResultadoCupon } from '../../lib/cupones'
import { useCerrarConAtras } from '../../hooks/useCerrarConAtras'
import { useDialog } from '../../context/DialogContext'

interface Props {
  open: boolean
  onClose: () => void
  onChanged: () => void
}

interface ItemSeleccionado {
  id: string
  nombre: string
  precio: number
  stock: number
  cantidad: number
}

export default function ManualOrderSheet({ open, onClose, onChanged }: Props) {
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [entrega, setEntrega] = useState<EntregaPedido>('coordinar')
  const [direccion, setDireccion] = useState('')
  const [localidad, setLocalidad] = useState('')
  const [cp, setCp] = useState('')
  const [provincia, setProvincia] = useState('')
  const [notas, setNotas] = useState('')

  const [productos, setProductos] = useState<ProductoConCategoria[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [pickerAbierto, setPickerAbierto] = useState(false)
  const [items, setItems] = useState<ItemSeleccionado[]>([])

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cupón opcional: se valida con la misma función que el checkout; la base lo
  // vuelve a validar al crear el pedido.
  const [cuponInput, setCuponInput] = useState('')
  const [cupon, setCupon] = useState<ResultadoCupon | null>(null)
  const [validandoCupon, setValidandoCupon] = useState(false)
  const [mensajeCupon, setMensajeCupon] = useState<string | null>(null)

  // Clave de idempotencia del alta: un reintento (ej. tras un corte de red) no
  // duplica el pedido. Se renueva al abrir la hoja, al cambiar los productos,
  // el cupón o la entrega, y después de crear el pedido.
  const claveRef = useRef<string | null>(null)
  const firmaItems = items.map((i) => `${i.id}:${i.cantidad}`).join('|')
  const firmaIntento = [firmaItems, cupon?.codigo ?? '', entrega, provincia, cp.trim()].join('#')
  useEffect(() => {
    claveRef.current = null
  }, [open, firmaIntento])

  function claveIdempotencia(): string {
    if (!claveRef.current) claveRef.current = nuevaClaveIdempotencia()
    return claveRef.current
  }

  useEffect(() => {
    if (!open) return
    setNombre('')
    setTelefono('')
    setEmail('')
    setEntrega('coordinar')
    setDireccion('')
    setLocalidad('')
    setCp('')
    setProvincia('')
    setNotas('')
    setBusqueda('')
    setPickerAbierto(false)
    setItems([])
    setError(null)
    setCuponInput('')
    setCupon(null)
    setMensajeCupon(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    let activo = true
    supabase
      .from('productos')
      .select('*, categorias(nombre)')
      .gt('stock', 0)
      .order('nombre')
      .then(({ data, error }) => {
        if (!activo || error || !data) return
        const filas = data.map((row) => {
          const { categorias, ...resto } = row as Record<string, unknown> & {
            categorias: { nombre: string } | null
          }
          return {
            ...(resto as unknown as ProductoConCategoria),
            categoria_nombre: categorias?.nombre ?? null,
          }
        })
        setProductos(filas)
      })
    return () => {
      activo = false
    }
  }, [open])

  // Si cambian los productos, el descuento validado ya no corresponde: se
  // quita el cupón (el código queda en el campo para aplicarlo de nuevo).
  function invalidarCupon() {
    if (!cupon) return
    setCuponInput(cupon.codigo)
    setCupon(null)
    setMensajeCupon('Cambiaron los productos: aplicá el cupón de nuevo.')
  }

  function agregarProducto(p: ProductoConCategoria) {
    invalidarCupon()
    setItems((prev) => {
      const existente = prev.find((i) => i.id === p.id)
      if (existente) {
        if (existente.cantidad >= existente.stock) return prev
        return prev.map((i) => (i.id === p.id ? { ...i, cantidad: i.cantidad + 1 } : i))
      }
      return [...prev, { id: p.id, nombre: p.nombre, precio: p.precio, stock: p.stock, cantidad: 1 }]
    })
    setBusqueda('')
    setPickerAbierto(false)
  }

  const productosDisponibles = productos.filter((p) => {
    const yaCompleto = items.some((i) => i.id === p.id && i.cantidad >= p.stock)
    if (yaCompleto) return false
    const term = busqueda.trim().toLowerCase()
    return !term || p.nombre.toLowerCase().includes(term)
  })

  function cambiarCantidad(id: string, delta: number) {
    invalidarCupon()
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i
        const cantidad = Math.min(i.stock, Math.max(1, i.cantidad + delta))
        return { ...i, cantidad }
      }),
    )
  }

  function quitarItem(id: string) {
    invalidarCupon()
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const subtotal = calcularSubtotal(items)

  async function aplicarCupon() {
    if (validandoCupon || cuponInput.trim() === '') return
    setValidandoCupon(true)
    setMensajeCupon(null)
    const r = await validarCupon(cuponInput, subtotal, { pedidoManual: true })
    setValidandoCupon(false)
    if (r.valido) {
      setCupon(r)
      setCuponInput('')
    } else {
      setMensajeCupon(r.mensaje)
    }
  }
  const nombreValido = nombre.trim().length >= 2
  const telefonoValido = telefono.replace(/\D/g, '').length >= 8
  // Opcional; si se carga, que tenga forma de email.
  const emailValido = email.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  // Para envío hace falta al menos dirección y localidad (CP y provincia opcionales).
  const entregaValida =
    entrega === 'coordinar' || (direccion.trim() !== '' && localidad.trim() !== '')
  const puedeConfirmar =
    nombreValido &&
    telefonoValido &&
    emailValido &&
    entregaValida &&
    items.length > 0 &&
    !guardando &&
    !validandoCupon

  // Qué falta para poder crear el pedido (antes el botón quedaba gris sin
  // decir por qué).
  const faltantes = [
    items.length === 0 && 'agregá al menos un producto',
    !nombreValido && 'el nombre (2 letras o más)',
    !telefonoValido && 'un teléfono de 8 dígitos o más',
    !emailValido && 'un email válido (o dejalo vacío)',
    !entregaValida && 'la dirección y la localidad del envío',
  ].filter(Boolean) as string[]

  const { confirmar, notificar } = useDialog()
  const hayCambios =
    open && (items.length > 0 || nombre.trim() !== '' || telefono.trim() !== '' || email.trim() !== '')

  async function pedirCierre(): Promise<boolean> {
    if (guardando) return false
    if (hayCambios) {
      const ok = await confirmar({
        titulo: '¿Descartar este pedido?',
        mensaje: 'Todavía no lo creaste: se pierden los datos cargados.',
        textoOk: 'Descartar',
        textoCancelar: 'Seguir cargando',
        peligro: true,
      })
      if (!ok) return false
    }
    onClose()
    return true
  }
  useCerrarConAtras(open, pedirCierre)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!puedeConfirmar) return
    setGuardando(true)
    setError(null)
    try {
      const numero = await crearPedido({
        datos: { nombre, telefono, email: email.trim() || null, entrega, direccion, localidad, cp, provincia, notas },
        items,
        origen: 'admin',
        idempotencyKey: claveIdempotencia(),
        cupon: cupon?.codigo ?? null,
      })
      claveRef.current = null
      onChanged()
      onClose()
      notificar(`Pedido #${numero} creado`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el pedido.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div
      className={open ? 'overlay open' : 'overlay'}
      onClick={(e) => {
        if (e.target === e.currentTarget) void pedirCierre()
      }}
    >
      <div className="sheet">
        <div className="handle" />
        <h2>Nuevo pedido manual</h2>

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="manual-nombre-de-la-clienta">Nombre de la clienta</label>
            <input
              id="manual-nombre-de-la-clienta" maxLength={120}
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Marina Gómez"
            />
          </div>

          <div className="field">
            <label htmlFor="manual-telefono">Teléfono</label>
            <input
              id="manual-telefono" maxLength={40}
              type="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="Ej: 11 5555 5555"
            />
          </div>

          <div className="field">
            <label htmlFor="manual-email">Email (opcional)</label>
            <input
              id="manual-email" maxLength={254}
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Ej: marina@gmail.com"
            />
            <p className="field-ayuda">
              Si se crea una cuenta en la tienda con este email, va a poder dejar su opinión de lo que
              compró. No le mandamos ningún mail.
            </p>
          </div>

          <div className="field">
            <label htmlFor="manual-entrega">Entrega</label>
            <select
              id="manual-entrega"
              value={entrega}
              onChange={(e) => setEntrega(e.target.value as EntregaPedido)}
            >
              <option value="coordinar">Retiro / a coordinar</option>
              <option value="envio">Envío a domicilio</option>
            </select>
          </div>

          {entrega === 'envio' && (
            <>
              <div className="field">
                <label htmlFor="manual-direccion">Dirección</label>
                <input
                  id="manual-direccion" maxLength={200}
                  type="text"
                  value={direccion}
                  onChange={(e) => setDireccion(e.target.value)}
                  placeholder="Calle y número"
                />
              </div>
              <div className="row2">
                <div className="field">
                  <label htmlFor="manual-localidad">Localidad</label>
                  <input
                    id="manual-localidad" maxLength={100}
                    type="text"
                    value={localidad}
                    onChange={(e) => setLocalidad(e.target.value)}
                    placeholder="Ciudad"
                  />
                </div>
                <div className="field">
                  <label htmlFor="manual-cp">Código postal</label>
                  <input
                    id="manual-cp" maxLength={20}
                    type="text"
                    inputMode="numeric"
                    value={cp}
                    onChange={(e) => setCp(e.target.value)}
                    placeholder="CP"
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="manual-provincia">Provincia (opcional)</label>
                <select
                  id="manual-provincia"
                  value={provincia}
                  onChange={(e) => setProvincia(e.target.value)}
                >
                  <option value="">Elegí una provincia</option>
                  {PROVINCIAS_AR.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="field order-product-picker">
            <label htmlFor="manual-agregar-producto">Agregar producto</label>
            <input
              id="manual-agregar-producto"
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onFocus={() => setPickerAbierto(true)}
              onBlur={() => setTimeout(() => setPickerAbierto(false), 150)}
              placeholder="Buscar o elegir producto…"
            />
            {pickerAbierto && (
              <div className="order-product-results">
                {productosDisponibles.length === 0 && (
                  <div className="order-product-empty">Sin productos con stock disponible.</div>
                )}
                {productosDisponibles.map((p) => (
                  <div key={p.id} className="order-product-result" onClick={() => agregarProducto(p)}>
                    <span className="name">{p.nombre}</span>
                    <span className="meta">
                      Stock: {p.stock} · {money(p.precio)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div className="field">
              <label>Productos del pedido</label>
              {items.map((i) => (
                <div key={i.id} className="order-item-selected">
                  <span className="name">{i.nombre}</span>
                  <div className="qty-stepper">
                    <button type="button" onClick={() => cambiarCantidad(i.id, -1)} disabled={i.cantidad <= 1}>
                      -
                    </button>
                    <span>{i.cantidad}</span>
                    <button type="button" onClick={() => cambiarCantidad(i.id, 1)} disabled={i.cantidad >= i.stock}>
                      +
                    </button>
                  </div>
                  <span className="line-subtotal">{money(i.precio * i.cantidad)}</span>
                  <button type="button" className="order-item-remove" onClick={() => quitarItem(i.id)}>
                    Quitar
                  </button>
                </div>
              ))}
              <div className="order-manual-subtotal">
                <span>Subtotal</span>
                <span>{money(subtotal)}</span>
              </div>
            </div>
          )}

          {items.length > 0 && (
            <div className="field manual-cupon">
              <label htmlFor="manual-cupon">Cupón (opcional)</label>
              {cupon ? (
                <div className="manual-cupon-aplicado">
                  <span className="manual-cupon-chip">{cupon.codigo}</span>
                  <span className="manual-cupon-desc">
                    {cupon.envioGratis && cupon.descuento <= 0
                      ? 'Envío gratis'
                      : `− ${money(cupon.descuento)}`}
                  </span>
                  <button
                    type="button"
                    className="manual-cupon-btn manual-cupon-btn--ghost"
                    onClick={() => setCupon(null)}
                    aria-label={`Quitar el cupón ${cupon.codigo}`}
                  >
                    Quitar
                  </button>
                </div>
              ) : (
                <div className="manual-cupon-fila">
                  <input
                    id="manual-cupon"
                    type="text"
                    value={cuponInput}
                    onChange={(e) => {
                      setCuponInput(e.target.value)
                      setMensajeCupon(null)
                    }}
                    onKeyDown={(e) => {
                      // Enter aplica el cupón en vez de crear el pedido.
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
                    aria-describedby="manual-cupon-msg"
                  />
                  <button
                    type="button"
                    className="manual-cupon-btn"
                    onClick={aplicarCupon}
                    disabled={validandoCupon || cuponInput.trim() === ''}
                  >
                    {validandoCupon ? 'Validando…' : 'Aplicar'}
                  </button>
                </div>
              )}
              <p id="manual-cupon-msg" className="manual-cupon-msg" role="status">
                {mensajeCupon ?? ''}
              </p>
              {cupon && (
                <p className="manual-cupon-nota">
                  El descuento y el envío los calcula la base al crear el pedido.
                </p>
              )}
            </div>
          )}

          <div className="field">
            <label htmlFor="manual-notas">Notas</label>
            <textarea
              id="manual-notas" maxLength={1000}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Detalles del pedido..."
            />
          </div>

          {error && <p className="form-error">{error}</p>}
          {faltantes.length > 0 && (
            <p className="manual-faltan">Para crear el pedido falta: {faltantes.join(', ')}.</p>
          )}

          <div className="sheet-actions">
            <button type="submit" className="btn btn-primary" disabled={!puedeConfirmar}>
              {guardando ? 'Guardando…' : 'Crear pedido'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void pedirCierre()}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
