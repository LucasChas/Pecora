import { useEffect, useState } from 'react'
import type { ProductoConCategoria } from '../../types'
import { supabase } from '../../lib/supabaseClient'
import { money } from '../../lib/format'

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
  const [notas, setNotas] = useState('')

  const [productos, setProductos] = useState<ProductoConCategoria[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [pickerAbierto, setPickerAbierto] = useState(false)
  const [items, setItems] = useState<ItemSeleccionado[]>([])

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setNombre('')
    setTelefono('')
    setNotas('')
    setBusqueda('')
    setPickerAbierto(false)
    setItems([])
    setError(null)
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

  function agregarProducto(p: ProductoConCategoria) {
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
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i
        const cantidad = Math.min(i.stock, Math.max(1, i.cantidad + delta))
        return { ...i, cantidad }
      }),
    )
  }

  function quitarItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const subtotal = items.reduce((n, i) => n + i.precio * i.cantidad, 0)
  const nombreValido = nombre.trim().length >= 2
  const telefonoValido = telefono.replace(/\D/g, '').length >= 8
  const puedeConfirmar = nombreValido && telefonoValido && items.length > 0 && !guardando

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!puedeConfirmar) return
    setGuardando(true)
    setError(null)
    try {
      const { error } = await supabase.rpc('crear_pedido', {
        p_nombre: nombre,
        p_telefono: telefono,
        p_email: null,
        p_entrega: 'coordinar',
        p_direccion: null,
        p_localidad: null,
        p_cp: null,
        p_notas: notas || null,
        p_items: items.map((i) => ({
          id: i.id,
          nombre: i.nombre,
          precio: i.precio,
          cantidad: i.cantidad,
        })),
        p_subtotal: subtotal,
        p_origen: 'admin',
      })
      if (error) throw new Error(error.message)
      onChanged()
      onClose()
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
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sheet">
        <div className="handle" />
        <h2>Nuevo pedido manual</h2>

        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Nombre de la clienta</label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Marina Gómez"
            />
          </div>

          <div className="field">
            <label>Teléfono</label>
            <input
              type="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="Ej: 11 5555 5555"
            />
          </div>

          <div className="field order-product-picker">
            <label>Agregar producto</label>
            <input
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

          <div className="field">
            <label>Notas</label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Detalles del pedido..."
            />
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="sheet-actions">
            <button type="submit" className="btn btn-primary" disabled={!puedeConfirmar}>
              {guardando ? 'Guardando…' : 'Crear pedido'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
