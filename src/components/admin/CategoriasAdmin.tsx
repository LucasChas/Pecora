import { useMemo, useState } from 'react'
import type { Categoria, ProductoConCategoria } from '../../types'
import { useDialog } from '../../context/DialogContext'
import { useCerrarConAtras } from '../../hooks/useCerrarConAtras'
import {
  contarPorCategoria,
  crearCategoria,
  eliminarCategoria,
  renombrarCategoria,
} from '../../lib/categorias'

interface Props {
  categorias: Categoria[]
  productos: ProductoConCategoria[]
  // Refresca productos y categorías del panel después de un cambio.
  onChanged: () => void
}

// Ajustes → Categorías: alta, renombrar y eliminar sin tener que entrar a un
// producto. Si la categoría tiene productos, al eliminarla se elige a qué
// otra categoría pasarlos (antes simplemente no se podía borrar).
export default function CategoriasAdmin({ categorias, productos, onChanged }: Props) {
  const { confirmar, avisar, notificar } = useDialog()
  const cuenta = useMemo(() => contarPorCategoria(productos), [productos])

  // Hoja de alta / renombrar.
  const [hoja, setHoja] = useState<{ modo: 'nueva' } | { modo: 'renombrar'; categoria: Categoria } | null>(null)
  const [nombre, setNombre] = useState('')
  // Hoja para eliminar una categoría con productos.
  const [borrando, setBorrando] = useState<Categoria | null>(null)
  const [destino, setDestino] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  function abrirNueva() {
    setNombre('')
    setError(null)
    setHoja({ modo: 'nueva' })
  }

  function abrirRenombrar(c: Categoria) {
    setNombre(c.nombre)
    setError(null)
    setHoja({ modo: 'renombrar', categoria: c })
  }

  async function guardarNombre(e: React.FormEvent) {
    e.preventDefault()
    if (!hoja || guardando) return
    setGuardando(true)
    const err =
      hoja.modo === 'nueva'
        ? await crearCategoria(nombre)
        : await renombrarCategoria(hoja.categoria.id, nombre)
    setGuardando(false)
    if (err) {
      setError(err)
      return
    }
    setHoja(null)
    onChanged()
    notificar(hoja.modo === 'nueva' ? 'Categoría creada' : 'Categoría renombrada')
  }

  async function pedirBorrado(c: Categoria) {
    const cantidad = cuenta.get(c.id) ?? 0
    if (cantidad > 0) {
      // Con productos: hoja para elegir a dónde moverlos.
      setDestino('')
      setError(null)
      setBorrando(c)
      return
    }
    const ok = await confirmar({
      titulo: `¿Eliminar la categoría "${c.nombre}"?`,
      mensaje: 'No tiene productos. Deja de aparecer en el muestrario. No se puede deshacer.',
      textoOk: 'Eliminar',
      peligro: true,
    })
    if (!ok) return
    const err = await eliminarCategoria(c.id, { cantidadProductos: 0 })
    if (err) {
      await avisar({ titulo: 'No se pudo eliminar la categoría', mensaje: err })
      return
    }
    onChanged()
    notificar(`Categoría "${c.nombre}" eliminada`)
  }

  async function moverYBorrar(e: React.FormEvent) {
    e.preventDefault()
    if (!borrando || guardando) return
    const cantidad = cuenta.get(borrando.id) ?? 0
    setGuardando(true)
    const err = await eliminarCategoria(borrando.id, { cantidadProductos: cantidad, moverA: destino })
    setGuardando(false)
    if (err) {
      setError(err)
      onChanged() // Por si los productos se movieron y falló solo el borrado.
      return
    }
    const nombreDestino = categorias.find((c) => c.id === destino)?.nombre ?? ''
    setBorrando(null)
    onChanged()
    notificar(`"${borrando.nombre}" eliminada · ${cantidad} producto${cantidad === 1 ? '' : 's'} pasaron a "${nombreDestino}"`)
  }

  // "Atrás" en el celular cierra la hoja abierta en vez de salir del panel.
  useCerrarConAtras(hoja !== null, () => setHoja(null))
  useCerrarConAtras(borrando !== null, () => setBorrando(null))

  const cantidadBorrando = borrando ? cuenta.get(borrando.id) ?? 0 : 0
  const otras = borrando ? categorias.filter((c) => c.id !== borrando.id) : []

  return (
    <>
      <div className="ajustes-subhead">
        <p>
          Las categorías ordenan el muestrario. Si eliminás una que tiene productos, elegís a qué
          otra categoría pasan.
        </p>
        <button type="button" className="head-action" onClick={abrirNueva}>
          + Nueva categoría
        </button>
      </div>

      <div className="list list--ajustes">
        {categorias.length === 0 ? (
          <div className="empty">Todavía no cargaste categorías.</div>
        ) : (
          categorias.map((c) => {
            const cantidad = cuenta.get(c.id) ?? 0
            return (
              <div className="ajuste-card cat-ajuste" key={c.id}>
                <div className="cat-ajuste-info">
                  <span className="ajuste-titulo">{c.nombre}</span>
                  <span className="ajuste-meta">
                    {cantidad === 0 ? 'Sin productos' : `${cantidad} producto${cantidad === 1 ? '' : 's'}`}
                  </span>
                </div>
                <div className="ajuste-acciones">
                  <button type="button" className="ajuste-btn" onClick={() => abrirRenombrar(c)}>
                    Renombrar
                  </button>
                  <button
                    type="button"
                    className="ajuste-btn ajuste-btn--peligro"
                    onClick={() => void pedirBorrado(c)}
                    aria-label={`Eliminar la categoría ${c.nombre}`}
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Alta / renombrar */}
      <div
        className={hoja ? 'overlay open' : 'overlay'}
        onClick={(e) => {
          if (e.target === e.currentTarget) setHoja(null)
        }}
      >
        <div className="sheet sheet--ajustes" role="dialog" aria-modal="true" aria-labelledby="cat-form-titulo">
          <div className="handle" />
          <h2 id="cat-form-titulo">
            {hoja?.modo === 'renombrar' ? `Renombrar "${hoja.categoria.nombre}"` : 'Nueva categoría'}
          </h2>
          <form onSubmit={guardarNombre} className="ajustes-form" noValidate>
            <div className="field">
              <label htmlFor="cat-nombre">Nombre</label>
              <input
                id="cat-nombre"
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Mordillos, Mantas, Sets"
              />
            </div>
            {error && hoja && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="sheet-actions">
              <button type="submit" className="btn btn-primary" disabled={guardando}>
                {guardando ? 'Guardando…' : hoja?.modo === 'renombrar' ? 'Guardar nombre' : 'Crear categoría'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setHoja(null)}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Eliminar una categoría con productos */}
      <div
        className={borrando ? 'overlay open' : 'overlay'}
        onClick={(e) => {
          if (e.target === e.currentTarget) setBorrando(null)
        }}
      >
        <div className="sheet sheet--ajustes" role="dialog" aria-modal="true" aria-labelledby="cat-borrar-titulo">
          <div className="handle" />
          <h2 id="cat-borrar-titulo">Eliminar "{borrando?.nombre}"</h2>
          <form onSubmit={moverYBorrar} className="ajustes-form" noValidate>
            <p className="ajuste-ayuda">
              Tiene {cantidadBorrando} producto{cantidadBorrando === 1 ? '' : 's'}. Elegí a qué categoría
              pasan antes de eliminarla. No se puede deshacer.
            </p>
            {otras.length === 0 ? (
              <p className="form-error" role="alert">
                Es la única categoría: creá otra primero para poder mover sus productos.
              </p>
            ) : (
              <div className="field">
                <label htmlFor="cat-destino">Mover los productos a</label>
                <select id="cat-destino" value={destino} onChange={(e) => setDestino(e.target.value)}>
                  <option value="">Elegí una categoría…</option>
                  {otras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} ({cuenta.get(c.id) ?? 0})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {error && borrando && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="sheet-actions">
              <button
                type="submit"
                className="btn btn-danger"
                disabled={guardando || !destino}
              >
                {guardando ? 'Eliminando…' : 'Mover y eliminar'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setBorrando(null)}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
