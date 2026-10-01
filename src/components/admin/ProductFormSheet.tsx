import { useEffect, useRef, useState } from 'react'
import type { Categoria, ProductoConCategoria } from '../../types'
import { supabase } from '../../lib/supabaseClient'
import { comprimirImagen } from '../../lib/imageCompress'
import { BUCKET_PRODUCTOS } from '../../lib/images'
import { subirOriginalConMiniatura } from '../../lib/thumbnails'
import { useDialog } from '../../context/DialogContext'
import { guardarProductoSinPisarStock, mensajeConflictoStock } from '../../lib/stock'
import ImagePicker, { type ImagenItem } from './ImagePicker'
import { useCerrarConAtras } from '../../hooks/useCerrarConAtras'

interface Props {
  open: boolean
  // Producto a editar, o null para dar de alta uno nuevo.
  producto: ProductoConCategoria | null
  categorias: Categoria[]
  onClose: () => void
  onGestionarCategorias: () => void
  // Refresca los datos después de guardar/borrar/crear categoría.
  onChanged: () => void
  // Alta a partir de otro producto ("Duplicar"): mismos datos y fotos, con
  // "(copia)" en el nombre y el stock vacío. Solo cuenta si producto es null.
  plantilla?: ProductoConCategoria | null
  onDuplicar?: (producto: ProductoConCategoria) => void
}

// Comprime y sube un archivo al bucket "productos" de Storage y, en paralelo,
// su miniatura (thumbs/<uuid>.jpg, ver lib/images); devuelve la URL del
// original. Solo se espera al original: si falla, el error sale en el acto; la
// miniatura nunca demora ni impide guardar (ver subirOriginalConMiniatura).
async function subirImagen(file: File): Promise<string> {
  const blob = await comprimirImagen(file) // se sube liviana (JPEG)
  const nombre = `${crypto.randomUUID()}.jpg`
  await subirOriginalConMiniatura(nombre, blob)
  const { data } = supabase.storage.from(BUCKET_PRODUCTOS).getPublicUrl(nombre)
  return data.publicUrl
}

// Imágenes ya guardadas de un producto (galería nueva, o la portada vieja),
// convertidas al ítem unificado que usa ImagePicker. El key es la propia URL:
// es estable entre renders y único dentro de la galería de un producto.
function imagenesGuardadas(p: ProductoConCategoria | null): ImagenItem[] {
  if (!p) return []
  const arr = (p.imagenes ?? []).filter(Boolean)
  const urls = arr.length ? arr : p.imagen_url ? [p.imagen_url] : []
  return urls.map((url) => ({ key: url, kind: 'url', url }))
}

// Resumen de los campos del formulario, para detectar cambios sin guardar.
function firmaCampos(
  nombre: string,
  categoriaId: string,
  descripcion: string,
  precio: string,
  stock: string,
  imagenes: ImagenItem[],
): string {
  return JSON.stringify([nombre, categoriaId, descripcion, precio, stock, imagenes.map((i) => i.key)])
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
  plantilla = null,
  onDuplicar,
}: Props) {
  const [nombre, setNombre] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [precio, setPrecio] = useState('')
  const [stock, setStock] = useState('')
  // Stock que había en la base al abrir: el guardado no pisa ventas posteriores.
  const [stockLeido, setStockLeido] = useState(0)
  // Galería: lista única y ordenada (URLs existentes + archivos nuevos
  // intercalados, en el orden en que se van a mostrar/guardar). El índice 0
  // es la portada. Reemplaza los antiguos keepUrls/newFiles disjuntos, que
  // no permitían intercalar una foto nueva antes de una existente.
  const [imagenes, setImagenes] = useState<ImagenItem[]>([])

  const [mostrarNuevaCat, setMostrarNuevaCat] = useState(false)
  const [nuevaCat, setNuevaCat] = useState('')

  const { confirmar, notificar } = useDialog()
  const [guardando, setGuardando] = useState(false)
  // Foto de los campos al abrir, para saber si hay cambios sin guardar.
  const [inicial, setInicial] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Referencia siempre actualizada al estado de imágenes, sólo para poder
  // revocar los object URLs de archivos nuevos al desmontar o al cambiar de
  // producto (no dispara re-render, no participa en el flujo de reorder).
  const imagenesRef = useRef<ImagenItem[]>([])
  useEffect(() => {
    imagenesRef.current = imagenes
  }, [imagenes])

  // Al abrir la hoja, cargamos los datos del producto (o valores vacíos si es alta).
  useEffect(() => {
    if (!open) return
    // Si veníamos de otro producto con fotos nuevas sin guardar, liberamos
    // sus previews antes de reemplazar la galería.
    imagenesRef.current.forEach((it) => {
      if (it.kind === 'file') URL.revokeObjectURL(it.preview)
    })
    // Datos de partida: el producto a editar, el que se duplica o vacío. En un
    // alta la categoría arranca sin elegir (antes quedaba la primera de la
    // lista sin avisar y era fácil guardar en la equivocada).
    const base = producto ?? plantilla
    const valores = {
      nombre: producto ? producto.nombre : plantilla ? `${plantilla.nombre} (copia)` : '',
      categoriaId: base?.categoria_id ?? '',
      descripcion: base?.descripcion ?? '',
      precio: base ? String(base.precio) : '',
      stock: producto ? String(producto.stock) : '',
      imagenes: imagenesGuardadas(base),
    }
    setNombre(valores.nombre)
    setCategoriaId(valores.categoriaId)
    setDescripcion(valores.descripcion)
    setPrecio(valores.precio)
    setStock(valores.stock)
    setStockLeido(producto?.stock ?? 0)
    setImagenes(valores.imagenes)
    setMostrarNuevaCat(false)
    setNuevaCat('')
    setError(null)
    setInicial(
      firmaCampos(
        valores.nombre,
        valores.categoriaId,
        valores.descripcion,
        valores.precio,
        valores.stock,
        valores.imagenes,
      ),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, producto, plantilla])

  const hayCambios =
    open && firmaCampos(nombre, categoriaId, descripcion, precio, stock, imagenes) !== inicial

  // Cerrar (Cancelar, tocar el fondo o "Atrás"): si hay cambios sin guardar,
  // pregunta antes de descartarlos (una foto a medio cargar se perdía con un
  // toque fuera de la hoja).
  async function pedirCierre(): Promise<boolean> {
    if (guardando) return false
    if (hayCambios) {
      const ok = await confirmar({
        titulo: '¿Descartar los cambios?',
        mensaje: 'Hay cambios sin guardar en este producto.',
        textoOk: 'Descartar',
        textoCancelar: 'Seguir editando',
        peligro: true,
      })
      if (!ok) return false
    }
    onClose()
    return true
  }
  useCerrarConAtras(open, pedirCierre)

  // Al desmontar el componente, liberamos cualquier preview de archivo nuevo
  // que haya quedado viva.
  useEffect(() => {
    return () => {
      imagenesRef.current.forEach((it) => {
        if (it.kind === 'file') URL.revokeObjectURL(it.preview)
      })
    }
  }, [])

  // Manejo de la galería de imágenes: cada archivo nuevo crea su object URL
  // UNA sola vez, al agregarse (no en cada render/reorder, que es lo que
  // causaba flicker/imágenes rotas al arrastrar con el efecto anterior).
  function agregarFiles(files: File[]) {
    const nuevos: ImagenItem[] = files.map((file) => ({
      key: crypto.randomUUID(),
      kind: 'file',
      file,
      preview: URL.createObjectURL(file),
    }))
    setImagenes((prev) => [...prev, ...nuevos])
  }

  // Reordenar y quitar imágenes llegan por el mismo callback desde
  // ImagePicker; acá detectamos qué archivos nuevos salieron para revocar
  // su preview (las URLs existentes no tienen nada que liberar).
  function onImagenesChange(next: ImagenItem[]) {
    const nextKeys = new Set(next.map((it) => it.key))
    for (const it of imagenes) {
      if (it.kind === 'file' && !nextKeys.has(it.key)) URL.revokeObjectURL(it.preview)
    }
    setImagenes(next)
  }

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
      // Recorremos la galería en el orden que dejó el drag-and-drop, subiendo
      // a Storage sólo las imágenes nuevas, en el lugar exacto donde quedaron
      // (ya no van todas al final como con keepUrls/newFiles separados).
      // Cada foto subida pasa a ser una URL en la galería: si después falla
      // algo y se reintenta, no se vuelve a subir (ni queda duplicada).
      const imagenesFinal: string[] = []
      const galeria = [...imagenes]
      for (let i = 0; i < galeria.length; i++) {
        const item = galeria[i]
        if (item.kind === 'url') {
          imagenesFinal.push(item.url)
          continue
        }
        const url = await subirImagen(item.file)
        imagenesFinal.push(url)
        URL.revokeObjectURL(item.preview)
        galeria[i] = { key: item.key, kind: 'url', url }
        setImagenes([...galeria])
      }

      const payload: Record<string, unknown> = {
        nombre,
        categoria_id: categoriaId,
        descripcion,
        precio: Number(precio) || 0,
        stock: Number(stock) || 0,
        imagenes: imagenesFinal,
        imagen_url: imagenesFinal[0] ?? null, // portada para la grilla / compatibilidad (índice 0)
      }

      if (producto) {
        // Si no tocó el stock, no se manda: así una venta que entró mientras
        // editaba (fotos, descripción...) no se deshace al guardar.
        if (payload.stock === stockLeido) delete payload.stock
        const r = await guardarProductoSinPisarStock(producto.id, payload, stockLeido)
        if (!r.ok && r.conflicto) {
          setStockLeido(r.stockActual)
          setError(mensajeConflictoStock(stockLeido, r.stockActual))
          return
        }
        if (!r.ok) throw new Error(r.error)
      } else {
        const { error } = await supabase.from('productos').insert(payload)
        if (error) throw error
      }
      onChanged() // Refresca los datos para que el cambio se vea al instante.
      onClose()
      notificar(producto ? 'Cambios guardados' : plantilla ? 'Copia creada' : 'Producto creado')
    } catch (err) {
      setError('No se pudo guardar: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setGuardando(false)
    }
  }

  async function duplicar() {
    if (!producto || !onDuplicar) return
    if (hayCambios) {
      const ok = await confirmar({
        titulo: '¿Duplicar sin guardar?',
        mensaje: 'Los cambios que hiciste en este producto se pierden. La copia sale de lo último guardado.',
        textoOk: 'Duplicar igual',
        textoCancelar: 'Volver',
      })
      if (!ok) return
    }
    onDuplicar(producto)
  }

  async function eliminar() {
    if (!producto) return
    const ok = await confirmar({
      titulo: `¿Eliminar "${producto.nombre}"?`,
      mensaje: 'Esta acción no se puede deshacer.',
      textoOk: 'Eliminar',
      peligro: true,
    })
    if (!ok) return
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
        if (e.target === e.currentTarget) void pedirCierre()
      }}
    >
      <div className="sheet sheet--producto">
        <div className="handle" />
        <h2>{producto ? 'Editar producto' : plantilla ? 'Duplicar producto' : 'Nuevo producto'}</h2>

        <form onSubmit={onSubmit}>
          <ImagePicker items={imagenes} onChange={onImagenesChange} onAddFiles={agregarFiles} />

          <div className="field">
            <label htmlFor="producto-nombre">Nombre</label>
            <input
              id="producto-nombre"
              type="text"
              required
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Body manga larga"
            />
          </div>

          <div className="field">
            <div className="field-label-row">
              <label htmlFor="producto-categoria">Categoría</label>
              <button type="button" className="link-btn" onClick={onGestionarCategorias}>
                Gestionar categorías
              </button>
            </div>
            <select
              id="producto-categoria"
              value={mostrarNuevaCat ? '__new__' : categoriaId}
              onChange={(e) => onCategoriaChange(e.target.value)}
            >
              {categorias.length === 0 ? (
                <option value="">Sin categorías todavía</option>
              ) : (
                !categoriaId && (
                  <option value="" disabled>
                    Elegí una categoría…
                  </option>
                )
              )}
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
            <label htmlFor="producto-descripcion-breve">Descripción breve</label>
            <textarea
              id="producto-descripcion-breve"
              required
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Talle, material, detalles..."
            />
          </div>

          <div className="row2">
            <div className="field">
              <label htmlFor="producto-precio-ars">Precio (ARS)</label>
              <input
                id="producto-precio-ars"
                type="number"
                inputMode="decimal"
                min={0}
                required
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="field">
              <label htmlFor="producto-stock">Stock</label>
              <input
                id="producto-stock"
                type="number"
                inputMode="numeric"
                min={0}
                required
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {error && <p className="form-error">{error}</p>}

          {producto && onDuplicar && (
            <button type="button" className="link-btn sheet-duplicar" onClick={() => void duplicar()}>
              Duplicar producto (para otro talle o color)
            </button>
          )}
          {producto && (
            <button type="button" className="btn-danger-text sheet-peligro" onClick={eliminar}>
              Eliminar producto
            </button>
          )}
          <div className="sheet-actions">
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar producto'}
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
