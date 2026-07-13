import { useEffect, useState } from 'react'
import type { ProductoConCategoria } from '../../types'
import { supabase } from '../../lib/supabaseClient'

interface Props {
  producto: ProductoConCategoria
  onEditar: (producto: ProductoConCategoria) => void
  // Refresca los datos después de guardar una edición inline.
  onChanged: () => void
}

const IMG_PLACEHOLDER = 'https://placehold.co/120x120/EEE1C4/B08F55?text=Pecora'

// Card de producto en el panel admin, con edición inline de precio y stock.
// Los cambios se guardan al salir del campo (onBlur) y Realtime refresca la
// vista (acá y en el catálogo público).
export default function ProductCard({ producto, onEditar, onChanged }: Props) {
  const disponible = producto.stock > 0

  // Estado local para poder escribir libremente; se confirma al salir del input.
  const [precio, setPrecio] = useState(String(producto.precio))
  const [stock, setStock] = useState(String(producto.stock))

  // Si el producto cambia desde afuera (Realtime), sincronizamos los inputs.
  useEffect(() => {
    setPrecio(String(producto.precio))
    setStock(String(producto.stock))
  }, [producto.precio, producto.stock])

  async function guardarCampo(campo: 'precio' | 'stock', valor: number) {
    const { error } = await supabase
      .from('productos')
      .update({ [campo]: valor })
      .eq('id', producto.id)
    if (error) alert('No se pudo guardar el cambio: ' + error.message)
    else onChanged() // Refresca datos tras guardar (pill de stock, catálogo, etc.)
  }

  // Al salir del campo: si quedó vacío o inválido, revertimos al valor guardado
  // (evita que un borrado accidental deje el precio/stock en 0). Si no cambió,
  // no escribimos de más.
  function confirmarCampo(campo: 'precio' | 'stock', texto: string, actual: number) {
    const n = Number(texto)
    if (texto.trim() === '' || Number.isNaN(n) || n < 0) {
      campo === 'precio' ? setPrecio(String(actual)) : setStock(String(actual))
      return
    }
    if (n === actual) return
    guardarCampo(campo, n)
  }

  return (
    <div className="prod-card">
      <img src={producto.imagen_url || IMG_PLACEHOLDER} alt="" />
      <div className="prod-main">
        <div className="prod-top">
          <div>
            <div className="prod-name">{producto.nombre}</div>
            <div className="prod-cat">{producto.categoria_nombre ?? 'Sin categoría'}</div>
          </div>
          <span className={disponible ? 'status-pill ok' : 'status-pill off'}>
            {disponible ? 'Disponible' : 'Sin stock'}
          </span>
        </div>

        <div className="prod-fields">
          <div className="mini-field">
            <label>Precio</label>
            <input
              type="number"
              min={0}
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              onBlur={() => confirmarCampo('precio', precio, producto.precio)}
            />
          </div>
          <div className="mini-field">
            <label>Stock</label>
            <input
              type="number"
              min={0}
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              onBlur={() => confirmarCampo('stock', stock, producto.stock)}
            />
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
