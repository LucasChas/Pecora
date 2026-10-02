import { useEffect, useRef, useState } from 'react'
import type { ProductoConCategoria } from '../../types'
import { useDialog } from '../../context/DialogContext'
import { portadaDe } from '../../lib/images'
import { STOCK_BAJO, guardarProductoSinPisarStock, mensajeConflictoStock } from '../../lib/stock'
import Miniatura from '../common/Miniatura'

interface Props {
  producto: ProductoConCategoria
  onEditar: (producto: ProductoConCategoria) => void
  // Refresca los datos después de guardar una edición inline.
  onChanged: () => void
}

// Card de producto en el panel admin, con edición inline de precio y stock.
// Los cambios se guardan al salir del campo (onBlur) y Realtime refresca la
// vista (acá y en el catálogo público).
export default function ProductCard({ producto, onEditar, onChanged }: Props) {
  const { avisar, notificar } = useDialog()
  const disponible = producto.stock > 0
  const pocoStock = disponible && producto.stock <= STOCK_BAJO

  // Estado local para poder escribir libremente; se confirma al salir del input.
  const [precio, setPrecio] = useState(String(producto.precio))
  const [stock, setStock] = useState(String(producto.stock))

  // Campo que se está editando y el stock que se veía al empezar a escribir.
  const editando = useRef<'precio' | 'stock' | null>(null)
  const stockAlEditar = useRef(producto.stock)

  // Escrituras de stock en curso (−/+ o tipeado): se guardan de a una, en
  // orden, cada una condicionada al valor que dejó la anterior.
  const colaStock = useRef<Promise<void>>(Promise.resolve())
  const stockPendientes = useRef(0)

  // Si el producto cambia desde afuera (Realtime), sincronizamos los inputs,
  // salvo el que tiene el foco (no le borramos lo que está escribiendo) y el
  // stock mientras haya escrituras en cola (mostraría un valor intermedio).
  useEffect(() => {
    if (editando.current !== 'precio') setPrecio(String(producto.precio))
    if (editando.current !== 'stock' && stockPendientes.current === 0) setStock(String(producto.stock))
  }, [producto.precio, producto.stock])

  function empezarEdicion(campo: 'precio' | 'stock') {
    editando.current = campo
    // El valor en pantalla: si hay toques de −/+ en cola, ya los incluye.
    const visible = Number(stock)
    stockAlEditar.current = Number.isNaN(visible) ? producto.stock : visible
  }

  function encolarStock(nuevo: number, base: number, avisarGuardado: boolean) {
    stockPendientes.current++
    colaStock.current = colaStock.current.then(async () => {
      try {
        const r = await guardarProductoSinPisarStock(producto.id, { stock: nuevo }, base)
        if (r.ok) {
          if (avisarGuardado) notificar('Stock guardado')
        } else if (r.conflicto) {
          setStock(String(r.stockActual))
          await avisar({ titulo: 'El stock cambió', mensaje: mensajeConflictoStock(base, r.stockActual) })
        } else {
          setStock(String(base))
          await avisar({ titulo: 'No se pudo guardar el cambio', mensaje: r.error })
        }
      } finally {
        stockPendientes.current--
        onChanged()
      }
    })
  }

  // El stock se guarda solo si en la base sigue el valor que se veía al
  // empezar a escribir: si entró una venta en el medio, se avisa en vez de
  // pisarla.
  async function guardarCampo(campo: 'precio' | 'stock', valor: number) {
    if (campo === 'stock') return encolarStock(valor, stockAlEditar.current, true)
    const r = await guardarProductoSinPisarStock(producto.id, { precio: valor }, producto.stock)
    if (r.ok) {
      notificar('Precio guardado')
      onChanged() // Refresca datos tras guardar (catálogo, etc.)
    } else {
      await avisar({ titulo: 'No se pudo guardar el cambio', mensaje: 'error' in r ? r.error : '' })
    }
  }

  // Botones −/+ de stock: sumar o restar una unidad sin tipear.
  function sumarStock(delta: 1 | -1) {
    const base = Number(stock)
    if (Number.isNaN(base) || base + delta < 0) return
    const nuevo = base + delta
    setStock(String(nuevo))
    encolarStock(nuevo, base, false)
  }

  // Al salir del campo: si quedó vacío o inválido, revertimos al valor guardado
  // (evita que un borrado accidental deje el precio/stock en 0). Si no cambió,
  // no escribimos de más. En ambos casos mostramos el valor actual de la base
  // (pudo cambiar por Realtime mientras tenía el foco).
  function confirmarCampo(campo: 'precio' | 'stock', texto: string, anterior: number) {
    editando.current = null
    const n = Number(texto)
    if (texto.trim() === '' || Number.isNaN(n) || n < 0 || n === anterior) {
      if (campo === 'precio') setPrecio(String(producto.precio))
      else if (stockPendientes.current === 0) setStock(String(producto.stock))
      else setStock(String(anterior))
      return
    }
    guardarCampo(campo, n)
  }

  return (
    <div className="prod-card">
      {/* Portada = primera de la galería (igual que el catálogo), en miniatura. */}
      <Miniatura src={portadaDe(producto)} alt="" width={60} height={60} />
      <div className="prod-main">
        <div className="prod-top">
          <div>
            <div className="prod-name">{producto.nombre}</div>
            <div className="prod-cat">{producto.categoria_nombre ?? 'Sin categoría'}</div>
          </div>
          <span className={!disponible ? 'status-pill off' : pocoStock ? 'status-pill low' : 'status-pill ok'}>
            {!disponible ? 'Sin stock' : pocoStock ? `Quedan ${producto.stock}` : 'Disponible'}
          </span>
        </div>

        <div className="prod-fields">
          <div className="mini-field">
            <label htmlFor={`precio-${producto.id}`}>Precio</label>
            <span className="precio-input">
              <input
                id={`precio-${producto.id}`}
                type="number"
                inputMode="decimal"
                min={0}
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                onFocus={() => empezarEdicion('precio')}
                onBlur={() => confirmarCampo('precio', precio, producto.precio)}
                // En desktop la rueda del mouse cambiaría el número sin querer
                // (y se guardaría al salir): soltamos el foco antes de que pase.
                onWheel={(e) => e.currentTarget.blur()}
              />
            </span>
          </div>
          <div className="mini-field mini-field--stock">
            <label htmlFor={`stock-${producto.id}`}>Stock</label>
            <div className="stock-stepper">
              <button
                type="button"
                aria-label={`Restar una unidad de ${producto.nombre}`}
                onClick={() => sumarStock(-1)}
                disabled={Number(stock) <= 0}
              >
                −
              </button>
              <input
                id={`stock-${producto.id}`}
                type="number"
                inputMode="numeric"
                min={0}
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                onFocus={() => empezarEdicion('stock')}
                onBlur={() => confirmarCampo('stock', stock, stockAlEditar.current)}
                onWheel={(e) => e.currentTarget.blur()}
              />
              <button
                type="button"
                aria-label={`Sumar una unidad de ${producto.nombre}`}
                onClick={() => sumarStock(1)}
              >
                +
              </button>
            </div>
          </div>
        </div>

        <div className="prod-actions">
          <button className="link-btn" onClick={() => onEditar(producto)}>
            Editar foto y datos
          </button>
        </div>
      </div>
    </div>
  )
}
