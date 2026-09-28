import { useEffect, useRef, useState } from 'react'
import type { Categoria, ProductoConCategoria } from '../../types'
import { supabase } from '../../lib/supabaseClient'
import { comprimirImagen } from '../../lib/imageCompress'
import { BUCKET_PRODUCTOS } from '../../lib/images'
import { subirOriginalConMiniatura } from '../../lib/thumbnails'
import { useDialog } from '../../context/DialogContext'
import {
  esColumnaInexistente,
  formMedidasDe,
  hayMedidas,
  parsearMedidas,
  type FormMedidas,
} from '../../lib/transportistas'
import ImagePicker, { type ImagenItem } from './ImagePicker'

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
  // Peso y medidas del paquete (opcionales): se usan para cotizar el envío
  // con Andreani / Correo Argentino.
  const [medidas, setMedidas] = useState<FormMedidas>(formMedidasDe(null))
  // Galería: lista única y ordenada (URLs existentes + archivos nuevos
  // intercalados, en el orden en que se van a mostrar/guardar). El índice 0
  // es la portada. Reemplaza los antiguos keepUrls/newFiles disjuntos, que
  // no permitían intercalar una foto nueva antes de una existente.
  const [imagenes, setImagenes] = useState<ImagenItem[]>([])

  const [mostrarNuevaCat, setMostrarNuevaCat] = useState(false)
  const [nuevaCat, setNuevaCat] = useState('')

  const { confirmar, avisar } = useDialog()
  const [guardando, setGuardando] = useState(false)
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
    setNombre(producto?.nombre ?? '')
    setCategoriaId(producto?.categoria_id ?? categorias[0]?.id ?? '')
    setDescripcion(producto?.descripcion ?? '')
    setPrecio(producto ? String(producto.precio) : '')
    setStock(producto ? String(producto.stock) : '')
    setMedidas(formMedidasDe(producto))
    setImagenes(imagenesGuardadas(producto))
    setMostrarNuevaCat(false)
    setNuevaCat('')
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, producto])

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
    const medidasParseadas = parsearMedidas(medidas)
    if (!medidasParseadas.ok) {
      setError(medidasParseadas.mensaje)
      return
    }
    setGuardando(true)
    setError(null)
    try {
      // Recorremos la galería en el orden que dejó el drag-and-drop, subiendo
      // a Storage sólo las imágenes nuevas, en el lugar exacto donde quedaron
      // (ya no van todas al final como con keepUrls/newFiles separados).
      const imagenesFinal: string[] = []
      for (const item of imagenes) {
        imagenesFinal.push(item.kind === 'url' ? item.url : await subirImagen(item.file))
      }

      const payload = {
        nombre,
        categoria_id: categoriaId,
        descripcion,
        precio: Number(precio) || 0,
        stock: Number(stock) || 0,
        imagenes: imagenesFinal,
        imagen_url: imagenesFinal[0] ?? null, // portada para la grilla / compatibilidad (índice 0)
      }

      const guardar = (datos: Record<string, unknown>) =>
        producto
          ? supabase.from('productos').update(datos).eq('id', producto.id)
          : supabase.from('productos').insert(datos)

      // Con peso y medidas; si la base todavía no tiene esas columnas (falta
      // la migración de transportistas), se guarda el resto igual.
      let { error } = await guardar({ ...payload, ...medidasParseadas.datos })
      let medidasSinGuardar = false
      if (error && esColumnaInexistente(error)) {
        medidasSinGuardar = hayMedidas(medidasParseadas.datos)
        ;({ error } = await guardar(payload))
      }
      if (error) throw error
      onChanged() // Refresca los datos para que el cambio se vea al instante.
      onClose()
      if (medidasSinGuardar) {
        await avisar({
          titulo: 'El producto se guardó sin peso ni medidas',
          mensaje:
            'Falta aplicar la migración de envíos con transportistas en Supabase. ' +
            'Cuando esté aplicada, volvé a cargar el peso y las medidas.',
        })
      }
    } catch (err) {
      setError('No se pudo guardar: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setGuardando(false)
    }
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
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sheet sheet--producto">
        <div className="handle" />
        <h2>{producto ? 'Editar producto' : 'Nuevo producto'}</h2>

        <form onSubmit={onSubmit}>
          <ImagePicker items={imagenes} onChange={onImagenesChange} onAddFiles={agregarFiles} />

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

          <fieldset className="medidas-envio">
            <legend>Peso y medidas del paquete (opcional)</legend>
            <p className="medidas-envio-ayuda" id="medidas-envio-ayuda">
              Se usan para cotizar el envío con Andreani y Correo Argentino. Cargalos para que el
              precio que ve la clienta sea preciso.
            </p>
            <div className="medidas-envio-grilla">
              {(
                [
                  { campo: 'peso', rotulo: 'Peso (g)', ejemplo: '300', decimales: false },
                  { campo: 'alto', rotulo: 'Alto (cm)', ejemplo: '5', decimales: true },
                  { campo: 'ancho', rotulo: 'Ancho (cm)', ejemplo: '25', decimales: true },
                  { campo: 'largo', rotulo: 'Largo (cm)', ejemplo: '30', decimales: true },
                ] as const
              ).map(({ campo, rotulo, ejemplo, decimales }) => (
                <div className="field" key={campo}>
                  <label htmlFor={`producto-${campo}`}>{rotulo}</label>
                  <input
                    id={`producto-${campo}`}
                    type="text"
                    inputMode={decimales ? 'decimal' : 'numeric'}
                    value={medidas[campo]}
                    onChange={(e) => setMedidas((m) => ({ ...m, [campo]: e.target.value }))}
                    placeholder={ejemplo}
                    autoComplete="off"
                    aria-describedby="medidas-envio-ayuda"
                  />
                </div>
              ))}
            </div>
          </fieldset>

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
