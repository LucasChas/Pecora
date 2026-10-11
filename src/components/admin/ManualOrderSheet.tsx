import { useEffect, useRef, useState } from 'react'
import type { EntregaPedido, MedioPago, ProductoConCategoria } from '../../types'
import { supabase } from '../../lib/supabaseClient'
import { aplanarProducto, conTalles } from '../../lib/productosConsulta'
import { money } from '../../lib/format'
import {
  PROVINCIAS_AR,
  calcularSubtotal,
  crearPedido,
  nuevaClaveIdempotencia,
} from '../../lib/orders'
import { validarCupon, type ResultadoCupon } from '../../lib/cupones'
import {
  MEDIOS_PAGO,
  crearFeria,
  etiquetaFeria,
  guardarPreferenciasVenta,
  hoyISO,
  leerPreferenciasVenta,
  listarFerias,
  ordenarFerias,
  registrarVentaFeria,
  type Feria,
  type ModoNuevoPedido,
} from '../../lib/ferias'
import { useCerrarConAtras } from '../../hooks/useCerrarConAtras'
import { useDialog } from '../../context/DialogContext'

interface Props {
  open: boolean
  onClose: () => void
  onChanged: () => void
}

interface ItemSeleccionado {
  // Producto y, si se vende por talle, el talle: cada talle es una línea.
  clave: string
  id: string
  talleId?: string
  nombre: string
  precio: number
  stock: number
  cantidad: number
}

// Lo que se puede elegir en el buscador: un producto o un talle de un producto.
type Opcion = Omit<ItemSeleccionado, 'cantidad'>

function opcionesDe(p: ProductoConCategoria): Opcion[] {
  const talles = p.talles ?? []
  if (talles.length === 0) {
    return [{ clave: p.id, id: p.id, nombre: p.nombre, precio: p.precio, stock: p.stock }]
  }
  return talles
    .filter((t) => t.stock > 0)
    .map((t) => ({
      clave: `${p.id}:${t.id}`,
      id: p.id,
      talleId: t.id,
      nombre: `${p.nombre} · Talle ${t.talle}`,
      precio: p.precio,
      stock: t.stock,
    }))
}

// Opción del selector de feria que abre el alta de una feria nueva.
const NUEVA_FERIA = '__nueva'

export default function ManualOrderSheet({ open, onClose, onChanged }: Props) {
  // Pedido manual (clienta por WhatsApp) o venta en la feria (sin datos de la
  // clienta: feria + medio de pago). El modo, la feria y el medio de pago se
  // recuerdan en el celular.
  const [modo, setModo] = useState<ModoNuevoPedido>('manual')
  const [ferias, setFerias] = useState<Feria[]>([])
  const [errorFerias, setErrorFerias] = useState<string | null>(null)
  const [feriaId, setFeriaId] = useState('')
  const [medioPago, setMedioPago] = useState<MedioPago>('efectivo')
  const [creandoFeria, setCreandoFeria] = useState(false)
  const [nombreFeria, setNombreFeria] = useState('')
  const [fechaFeria, setFechaFeria] = useState(hoyISO())
  const [guardandoFeria, setGuardandoFeria] = useState(false)
  const esFeria = modo === 'feria'

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
  const firmaItems = items.map((i) => `${i.clave}:${i.cantidad}`).join('|')
  const firmaIntento = [modo, feriaId, medioPago, firmaItems, cupon?.codigo ?? '', entrega, provincia, cp.trim()].join('#')
  useEffect(() => {
    claveRef.current = null
  }, [open, firmaIntento])

  function claveIdempotencia(): string {
    if (!claveRef.current) claveRef.current = nuevaClaveIdempotencia()
    return claveRef.current
  }

  useEffect(() => {
    if (!open) return
    const pref = leerPreferenciasVenta()
    setModo(pref.modo)
    setFeriaId(pref.feriaId ?? '')
    setMedioPago(pref.medioPago)
    setCreandoFeria(false)
    setNombreFeria('')
    setFechaFeria(hoyISO())
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

  // Productos con stock. Se vuelve a pedir después de cada venta de feria
  // (la hoja queda abierta y el stock cambió).
  const [versionProductos, setVersionProductos] = useState(0)
  useEffect(() => {
    if (!open) return
    let activo = true
    conTalles((select) => supabase.from('productos').select(select).gt('stock', 0).order('nombre')).then(
      ({ data, error }) => {
        if (!activo || error || !data) return
        setProductos((data as unknown[]).map(aplanarProducto))
      },
    )
    return () => {
      activo = false
    }
  }, [open, versionProductos])

  useEffect(() => {
    if (!open) return
    let activo = true
    setErrorFerias(null)
    listarFerias().then(
      (lista) => {
        if (!activo) return
        setFerias(lista)
        // La feria recordada ya no está (se archivó): se elige de nuevo.
        setFeriaId((id) => (lista.some((f) => f.id === id) ? id : ''))
      },
      (err: unknown) => {
        if (activo) setErrorFerias(err instanceof Error ? err.message : 'No se pudieron cargar las ferias.')
      },
    )
    return () => {
      activo = false
    }
  }, [open])

  // Recordar modo, feria y medio de pago para la próxima vez.
  useEffect(() => {
    if (!open) return
    guardarPreferenciasVenta({ modo, feriaId: feriaId || null, medioPago })
  }, [open, modo, feriaId, medioPago])

  // Si cambian los productos, el descuento validado ya no corresponde: se
  // quita el cupón (el código queda en el campo para aplicarlo de nuevo).
  function invalidarCupon() {
    if (!cupon) return
    setCuponInput(cupon.codigo)
    setCupon(null)
    setMensajeCupon('Cambiaron los productos: aplicá el cupón de nuevo.')
  }

  function agregarProducto(o: Opcion) {
    invalidarCupon()
    setItems((prev) => {
      const existente = prev.find((i) => i.clave === o.clave)
      if (existente) {
        if (existente.cantidad >= existente.stock) return prev
        return prev.map((i) => (i.clave === o.clave ? { ...i, cantidad: i.cantidad + 1 } : i))
      }
      return [...prev, { ...o, cantidad: 1 }]
    })
    setBusqueda('')
    setPickerAbierto(false)
  }

  const productosDisponibles = productos.flatMap(opcionesDe).filter((o) => {
    const yaCompleto = items.some((i) => i.clave === o.clave && i.cantidad >= o.stock)
    if (yaCompleto) return false
    const term = busqueda.trim().toLowerCase()
    return !term || o.nombre.toLowerCase().includes(term)
  })

  function cambiarCantidad(clave: string, delta: number) {
    invalidarCupon()
    setItems((prev) =>
      prev.map((i) => {
        if (i.clave !== clave) return i
        const cantidad = Math.min(i.stock, Math.max(1, i.cantidad + delta))
        return { ...i, cantidad }
      }),
    )
  }

  function quitarItem(clave: string) {
    invalidarCupon()
    setItems((prev) => prev.filter((i) => i.clave !== clave))
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
  const feriaValida = feriaId !== '' && ferias.some((f) => f.id === feriaId)
  const puedeConfirmar =
    (esFeria ? feriaValida : nombreValido && telefonoValido && emailValido && entregaValida) &&
    items.length > 0 &&
    !guardando &&
    !validandoCupon

  // Qué falta para poder crear el pedido (antes el botón quedaba gris sin
  // decir por qué).
  const faltantes = (
    esFeria
      ? [!feriaValida && 'elegí la feria', items.length === 0 && 'agregá al menos un producto']
      : [
          items.length === 0 && 'agregá al menos un producto',
          !nombreValido && 'el nombre (2 letras o más)',
          !telefonoValido && 'un teléfono de 8 dígitos o más',
          !emailValido && 'un email válido (o dejalo vacío)',
          !entregaValida && 'la dirección y la localidad del envío',
        ]
  ).filter(Boolean) as string[]

  const { confirmar, notificar } = useDialog()
  const hayDatosClienta =
    nombre.trim() !== '' || telefono.trim() !== '' || email.trim() !== '' || notas.trim() !== '' || cupon !== null
  const hayCambios = open && (items.length > 0 || hayDatosClienta)

  // Pasar a Feria descarta los datos de la clienta (los productos quedan).
  async function cambiarModo(nuevo: ModoNuevoPedido) {
    if (nuevo === modo || guardando) return
    if (nuevo === 'feria' && hayDatosClienta) {
      const ok = await confirmar({
        titulo: '¿Pasar a venta en la feria?',
        mensaje: 'Se borran los datos de la clienta que cargaste. Los productos quedan.',
        textoOk: 'Pasar a feria',
        textoCancelar: 'Seguir con el pedido',
        peligro: true,
      })
      if (!ok) return
      setNombre('')
      setTelefono('')
      setEmail('')
      setEntrega('coordinar')
      setDireccion('')
      setLocalidad('')
      setCp('')
      setProvincia('')
      setNotas('')
      setCupon(null)
      setCuponInput('')
      setMensajeCupon(null)
    }
    setError(null)
    setModo(nuevo)
  }

  function elegirFeria(valor: string) {
    if (valor === NUEVA_FERIA) {
      setCreandoFeria(true)
      return
    }
    setFeriaId(valor)
  }

  async function guardarNuevaFeria() {
    if (guardandoFeria) return
    setGuardandoFeria(true)
    setError(null)
    try {
      const f = await crearFeria(nombreFeria, fechaFeria)
      setFerias((prev) => ordenarFerias([...prev, f]))
      setFeriaId(f.id)
      setCreandoFeria(false)
      setNombreFeria('')
      setFechaFeria(hoyISO())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la feria.')
    } finally {
      setGuardandoFeria(false)
    }
  }

  async function pedirCierre(): Promise<boolean> {
    if (guardando) return false
    if (hayCambios) {
      const ok = await confirmar({
        titulo: esFeria ? '¿Descartar esta venta?' : '¿Descartar este pedido?',
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
    if (esFeria) {
      try {
        const numero = await registrarVentaFeria({
          feriaId,
          medioPago,
          items,
          idempotencyKey: claveIdempotencia(),
        })
        claveRef.current = null
        onChanged()
        // La hoja queda abierta con la misma feria, lista para la próxima
        // clienta.
        setItems([])
        setBusqueda('')
        setVersionProductos((v) => v + 1)
        notificar(`Venta #${numero} registrada`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo registrar la venta.')
      } finally {
        setGuardando(false)
      }
      return
    }
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
        <h2>Nuevo pedido</h2>

        <div className="modo-pedido" role="group" aria-label="Tipo de pedido">
          <button
            type="button"
            className={esFeria ? 'modo-pedido-btn' : 'modo-pedido-btn activo'}
            aria-pressed={!esFeria}
            onClick={() => void cambiarModo('manual')}
          >
            Pedido manual
          </button>
          <button
            type="button"
            className={esFeria ? 'modo-pedido-btn activo' : 'modo-pedido-btn'}
            aria-pressed={esFeria}
            onClick={() => void cambiarModo('feria')}
          >
            Feria
          </button>
        </div>

        <form onSubmit={onSubmit}>
          {esFeria && (
            <>
              <div className="field">
                <label htmlFor="manual-feria">Feria</label>
                {creandoFeria ? (
                  <div className="feria-nueva">
                    <input
                      id="manual-feria"
                      type="text"
                      maxLength={80}
                      value={nombreFeria}
                      onChange={(e) => setNombreFeria(e.target.value)}
                      onKeyDown={(e) => {
                        // Enter crea la feria en vez de registrar la venta.
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void guardarNuevaFeria()
                        }
                      }}
                      placeholder="Ej: Feria de Plaza San Martín"
                      autoFocus
                    />
                    <input
                      type="date"
                      value={fechaFeria}
                      onChange={(e) => setFechaFeria(e.target.value)}
                      aria-label="Fecha de la feria"
                    />
                    <div className="feria-nueva-acciones">
                      <button
                        type="button"
                        className="manual-cupon-btn"
                        onClick={() => void guardarNuevaFeria()}
                        disabled={guardandoFeria || nombreFeria.trim() === ''}
                      >
                        {guardandoFeria ? 'Creando…' : 'Crear feria'}
                      </button>
                      {ferias.length > 0 && (
                        <button
                          type="button"
                          className="manual-cupon-btn manual-cupon-btn--ghost"
                          onClick={() => setCreandoFeria(false)}
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <select id="manual-feria" value={feriaId} onChange={(e) => elegirFeria(e.target.value)}>
                    <option value="">Elegí una feria</option>
                    {ferias.map((f) => (
                      <option key={f.id} value={f.id}>
                        {etiquetaFeria(f)}
                      </option>
                    ))}
                    <option value={NUEVA_FERIA}>+ Nueva feria…</option>
                  </select>
                )}
                {errorFerias && <p className="form-error">{errorFerias}</p>}
              </div>

              <div className="field">
                <label id="manual-medio-pago">Medio de pago</label>
                <div className="medio-pago" role="group" aria-labelledby="manual-medio-pago">
                  {MEDIOS_PAGO.map((m) => (
                    <button
                      key={m.valor}
                      type="button"
                      className={medioPago === m.valor ? 'medio-pago-btn activo' : 'medio-pago-btn'}
                      aria-pressed={medioPago === m.valor}
                      onClick={() => setMedioPago(m.valor)}
                    >
                      {m.etiqueta}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {!esFeria && (
            <>
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
                  <div key={p.clave} className="order-product-result" onClick={() => agregarProducto(p)}>
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
                <div key={i.clave} className="order-item-selected">
                  <span className="name">{i.nombre}</span>
                  <div className="qty-stepper">
                    <button type="button" onClick={() => cambiarCantidad(i.clave, -1)} disabled={i.cantidad <= 1}>
                      -
                    </button>
                    <span>{i.cantidad}</span>
                    <button type="button" onClick={() => cambiarCantidad(i.clave, 1)} disabled={i.cantidad >= i.stock}>
                      +
                    </button>
                  </div>
                  <span className="line-subtotal">{money(i.precio * i.cantidad)}</span>
                  <button type="button" className="order-item-remove" onClick={() => quitarItem(i.clave)}>
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

          {!esFeria && items.length > 0 && (
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

          {!esFeria && (
            <div className="field">
              <label htmlFor="manual-notas">Notas</label>
              <textarea
                id="manual-notas" maxLength={1000}
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Detalles del pedido..."
              />
            </div>
          )}

          {error && <p className="form-error">{error}</p>}
          {faltantes.length > 0 && (
            <p className="manual-faltan">
              Para {esFeria ? 'registrar la venta' : 'crear el pedido'} falta: {faltantes.join(', ')}.
            </p>
          )}

          <div className="sheet-actions">
            <button type="submit" className="btn btn-primary" disabled={!puedeConfirmar}>
              {guardando ? 'Guardando…' : esFeria ? 'Registrar venta' : 'Crear pedido'}
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
