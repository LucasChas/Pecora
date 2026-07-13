import { useState } from 'react'
import type { Categoria, ProductoConCategoria } from '../../types'
import { supabase } from '../../lib/supabaseClient'

interface Props {
  open: boolean
  categorias: Categoria[]
  productos: ProductoConCategoria[]
  onClose: () => void
}

// Hoja para gestionar categorías: listar con la cantidad de productos de cada
// una, agregar nuevas y eliminar. El borrado se bloquea si la categoría tiene
// productos (además el backend lo rechaza vía FK/trigger, ver migración).
export default function CategoryManagerSheet({ open, categorias, productos, onClose }: Props) {
  const [nueva, setNueva] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Cuenta cuántos productos usan cada categoría.
  function contar(categoriaId: string): number {
    return productos.filter((p) => p.categoria_id === categoriaId).length
  }

  async function agregar() {
    const limpio = nueva.trim()
    if (!limpio) return
    const { error } = await supabase.from('categorias').insert({ nombre: limpio })
    if (error) {
      setError('No se pudo agregar: ' + error.message)
      return
    }
    setNueva('')
    setError(null)
  }

  async function eliminar(categoria: Categoria) {
    // Guardia en el frontend (el backend igual lo refuerza).
    if (contar(categoria.id) > 0) return
    const { error } = await supabase.from('categorias').delete().eq('id', categoria.id)
    if (error) {
      setError('No se pudo eliminar: ' + error.message)
    } else {
      setError(null)
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
        <h2>Categorías</h2>

        <div className="cat-manage-list">
          {categorias.length === 0 ? (
            <div className="cat-manage-empty">Todavía no cargaste categorías.</div>
          ) : (
            categorias.map((c) => {
              const cantidad = contar(c.id)
              const enUso = cantidad > 0
              return (
                <div className="cat-manage-item" key={c.id}>
                  <div>
                    <span className="cat-name">{c.nombre}</span>
                    <span className="cat-count">
                      {cantidad} producto{cantidad === 1 ? '' : 's'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-del-cat"
                    disabled={enUso}
                    title={
                      enUso
                        ? 'Reasigná o eliminá primero los productos de esta categoría'
                        : 'Eliminar categoría'
                    }
                    onClick={() => eliminar(c)}
                  >
                    ✕
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="cat-manage-add">
          <input
            type="text"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            placeholder="Nombre de la categoría"
          />
          <button type="button" onClick={agregar}>
            Agregar
          </button>
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
