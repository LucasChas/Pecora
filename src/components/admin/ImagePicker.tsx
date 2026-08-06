import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState } from 'react'
import ImageZoom from './ImageZoom'

// Imagen ya guardada en Storage (URL) o imagen nueva elegida del teléfono
// (todavía sin subir). `key` es estable por ítem: lo usa dnd-kit para
// identificar cada tile aunque el orden cambie, y no puede depender del
// índice porque el índice es justo lo que el drag va a mover.
export type ImagenItem =
  | { key: string; kind: 'url'; url: string }
  | { key: string; kind: 'file'; file: File; preview: string }

interface Props {
  items: ImagenItem[]
  onChange: (items: ImagenItem[]) => void
  onAddFiles: (files: File[]) => void
}

// Selector de MÚLTIPLES imágenes para el producto, con reordenamiento por
// drag-and-drop. Abre la galería del teléfono (input multiple, sin capture
// para no ir directo a la cámara), muestra una vista previa de cada foto
// (existentes + nuevas) en un único orden, y permite quitarlas o arrastrarlas
// a otra posición. El índice 0 es la portada (sin columna nueva en la DB).
// La subida a Storage la hace ProductFormSheet al guardar, no acá.
export default function ImagePicker({ items, onChange, onAddFiles }: Props) {
  // Distancia/retardo de activación: sin esto, el primer touchmove dentro del
  // `.sheet` (que es scrolleable) dispara el drag y el admin no puede hacer
  // scroll del formulario en el celular. Con la constraint, un swipe vertical
  // normal scrollea y sólo un gesto deliberado (mover 8px con mouse/lápiz, o
  // mantener 200ms con el dedo) inicia el drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
  )

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : []
    if (files.length) onAddFiles(files)
    // Limpiamos el input para poder volver a elegir el mismo archivo si hace falta.
    e.target.value = ''
  }

  function onRemove(key: string) {
    onChange(items.filter((it) => it.key !== key))
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = items.findIndex((it) => it.key === active.id)
    const to = items.findIndex((it) => it.key === over.id)
    if (from === -1 || to === -1) return
    onChange(arrayMove(items, from, to))
  }

  const hayImagenes = items.length > 0

  // Zoom (imagen ampliada) al tocar/clickear el tile: el admin puede
  // inspeccionar calidad/detalle de una foto mientras gestiona el producto.
  // Guarda sólo el `src` de la imagen ampliada; no hace falta el item completo.
  const [zoomSrc, setZoomSrc] = useState<string | null>(null)

  return (
    <div className="img-multi">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div className="img-grid">
          <SortableContext items={items.map((it) => it.key)} strategy={rectSortingStrategy}>
            {items.map((item, i) => (
              <ImageTile
                key={item.key}
                item={item}
                esPortada={i === 0}
                onRemove={onRemove}
                onZoom={setZoomSrc}
              />
            ))}
          </SortableContext>

          {/* Tile para agregar más fotos: no es sorteable, es un botón de acción. */}
          <label className="img-add">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            <span>Agregar fotos</span>
            <input type="file" accept="image/*" multiple onChange={onInputChange} />
          </label>
        </div>
      </DndContext>

      {!hayImagenes && (
        <p className="img-hint">Elegí una o varias fotos de la galería del teléfono.</p>
      )}

      {zoomSrc && (
        <ImageZoom src={zoomSrc} alt="" onClose={() => setZoomSrc(null)} />
      )}
    </div>
  )
}

function ImageTile({
  item,
  esPortada,
  onRemove,
  onZoom,
}: {
  item: ImagenItem
  esPortada: boolean
  onRemove: (key: string) => void
  onZoom: (src: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
  })

  const src = item.kind === 'url' ? item.url : item.preview

  return (
    <div
      ref={setNodeRef}
      className={isDragging ? 'img-tile img-tile-dragging' : 'img-tile'}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {esPortada && <span className="img-cover-badge">Portada</span>}
      {/* Tap/click en la imagen (distinto de la manija de arrastre y del
          botón de quitar) abre el zoom fullscreen para esa foto. */}
      <img
        src={src}
        alt=""
        onClick={() => onZoom(src)}
        role="button"
        aria-label="Ver imagen ampliada"
      />
      {/* Manija de arrastre: sólo esta zona bloquea el scroll táctil
          (touch-action: none), no el tile completo. */}
      <button
        type="button"
        className="img-drag-handle"
        aria-label="Arrastrar para reordenar"
        {...attributes}
        {...listeners}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="8" cy="6" r="1.5" />
          <circle cx="16" cy="6" r="1.5" />
          <circle cx="8" cy="12" r="1.5" />
          <circle cx="16" cy="12" r="1.5" />
          <circle cx="8" cy="18" r="1.5" />
          <circle cx="16" cy="18" r="1.5" />
        </svg>
      </button>
      <button
        type="button"
        className="img-remove"
        onClick={() => onRemove(item.key)}
        aria-label="Quitar imagen"
      >
        ✕
      </button>
    </div>
  )
}
