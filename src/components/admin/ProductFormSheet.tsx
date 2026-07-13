import { useEffect, useState } from 'react'
import type { Categoria, ProductoConCategoria } from '../../types'
import { supabase } from '../../lib/supabaseClient'
import ImagePicker from './ImagePicker'

interface Props {
  open: boolean
  // Producto a editar, o null para dar de alta uno nuevo.
  producto: ProductoConCategoria | null
  categorias: Categoria[]
  onClose: () => void
  onGestionarCategorias: () => void
  // Refresca los datos después de guardar/borrar/crear categoría.
  onChanged: () => void
}

// Sube un archivo al bucket "productos" de Storage y devuelve su URL pública.
async function subirImagen(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const nombre = `${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from('productos')
    .upload(nombre, file, { cacheControl: '3600', upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from('productos').getPublicUrl(nombre)
  return data.publicUrl
}

// Hoja (bottom sheet) para crear o editar un producto.
// Incluye la carga de imagen (a Storage) y el selector de categoría con la
// opción de crear una nueva sin salir del formulario.
export default function ProductFormSheet({
  open,
  producto,
  categorias,
  onClose,
  onGestionarCategorias,
  onChanged,
}: Props) {
  const [nombre, setNombre] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [precio, setPrecio] = useState('')
  const [stock, setStock] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const [mostrarNuevaCat, setMostrarNuevaCat] = useState(false)
  const [nuevaCat, setNuevaCat] = useState('')

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Al abrir la hoja, cargamos los datos del producto (o valores vacíos si es alta).
  useEffect(() => {
    if (!open) return
    setNombre(producto?.nombre ?? '')
    setCategoriaId(producto?.categoria_id ?? categorias[0]?.id ?? '')
    setDescripcion(producto?.descripcion ?? '')
    setPrecio(producto ? String(producto.precio) : '')
    setStock(producto ? String(producto.stock) : '')
    setFile(null)
    setMostrarNuevaCat(false)
    setNuevaCat('')
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, producto])

  function onCategoriaChange(valor: string) {
    if (valor === '__new__') {
      setMostrarNuevaCat(true)
    } else {
      setMostrarNuevaCat(false)
      setCategoriaId(valor)
    }
  }

  // Crea una categoría nueva desde el mismo formulario y la deja seleccionada.
  async function agregarCategoria() {
    const limpio = nuevaCat.trim()
    if (!limpio) return
    const { data, error } = await supabase
      .from('categorias')
      .insert({ nombre: limpio })
      .select()
      .single()
    if (error) {
      setError('No se pudo crear la categoría: ' + error.message)
      return
    }
    setCategoriaId(data.id)
    setNuevaCat('')
    setMostrarNuevaCat(false)
    onChanged() // Refresca la lista de categorías (acá y en el catálogo).
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!categoriaId || categoriaId === '__new__') {
      setError('Elegí o creá una categoría.')
      return
    }
    setGuardando(true)
    setError(null)
    try {
      // Si eligió una imagen nueva, la subimos; si no, conservamos la anterior.
      let imagen_url = producto?.imagen_url ?? null
      if (file) imagen_url = await subirImagen(file)

      const payload = {
        nombre,
        categoria_id: categoriaId,
        descripcion,
        precio: Number(precio) || 0,
        stock: Number(stock) || 0,
        imagen_url,
      }

      if (producto) {
        const { error } = await supabase.from('productos').update(payload).eq('id', producto.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('productos').insert(payload)
        if (error) throw error
      }
      onChanged() // Refresca los datos para que el cambio se vea al instante.
      onClose()
    } catch (err) {
      setError('No se pudo guardar: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setGuardando(false)
    }
  }

  async function eliminar() {
    if (!producto) return
    if (!confirm(`¿Eliminar "${producto.nombre}"? Esta acción no se puede deshacer.`)) return
    const { error } = await supabase.from('productos').delete().eq('id', producto.id)
    if (error) {
      setError('No se pudo eliminar: ' + error.message)
      return
    }
    onChanged() // Refresca la lista tras borrar.
    onClose()
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
        <h2>{producto ? 'Editar producto' : 'Nuevo producto'}</h2>

        <form onSubmit={onSubmit}>
          <ImagePicker imagenActual={producto?.imagen_url ?? null} onFileSelected={setFile} />

          <div className="field">
            <label>Nombre</label>
            <input
              type="text"
              required
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Body manga larga"
            />
          </div>

          <div className="field">
            <div className="field-label-row">
              <label>Categoría</label>
              <button type="button" className="link-btn" onClick={onGestionarCategorias}>
                Gestionar categorías
              </button>
            </div>
            <select
              value={mostrarNuevaCat ? '__new__' : categoriaId}
              onChange={(e) => onCategoriaChange(e.target.value)}
            >
              {categorias.length === 0 && <option value="">Sin categorías todavía</option>}
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
              <option value="__new__">+ Agregar categoría nueva...</option>
            </select>

            {mostrarNuevaCat && (
              <div className="new-cat-row">
                <input
                  type="text"
                  autoFocus
                  value={nuevaCat}
                  onChange={(e) => setNuevaCat(e.target.value)}
                  placeholder="Nombre de la categoría"
                />
                <button type="button" onClick={agregarCategoria}>
                  Agregar
                </button>
              </div>
            )}
          </div>

          <div className="field">
            <label>Descripción breve</label>
            <textarea
              required
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Talle, material, detalles..."
            />
          </div>

          <div className="row2">
            <div className="field">
              <label>Precio (ARS)</label>
              <input
                type="number"
                min={0}
                required
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="field">
              <label>Stock</label>
              <input
                type="number"
                min={0}
                required
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="sheet-actions">
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar producto'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            {producto && (
              <button type="button" className="btn-danger-text" onClick={eliminar}>
                Eliminar producto
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
