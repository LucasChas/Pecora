import { useEffect, useState } from 'react'

interface Props {
  // Imágenes ya guardadas que se conservan (URLs de Storage).
  keepUrls: string[]
  // Imágenes nuevas elegidas del teléfono, todavía sin subir.
  newFiles: File[]
  onAddFiles: (files: File[]) => void
  onRemoveUrl: (index: number) => void
  onRemoveFile: (index: number) => void
}

// Selector de MÚLTIPLES imágenes para el producto. Abre la galería del teléfono
// (input multiple, sin capture para no ir directo a la cámara), muestra una
// vista previa de cada foto (existentes + nuevas) y permite quitarlas.
// La subida a Storage la hace ProductFormSheet al guardar, no acá.
export default function ImagePicker({
  keepUrls,
  newFiles,
  onAddFiles,
  onRemoveUrl,
  onRemoveFile,
}: Props) {
  // Vistas previas locales de los archivos nuevos (object URLs). Se recrean
  // cuando cambia la lista y se liberan al desmontar para no perder memoria.
  const [previews, setPreviews] = useState<string[]>([])
  useEffect(() => {
    const urls = newFiles.map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [newFiles])

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : []
    if (files.length) onAddFiles(files)
    // Limpiamos el input para poder volver a elegir el mismo archivo si hace falta.
    e.target.value = ''
  }

  const hayImagenes = keepUrls.length > 0 || newFiles.length > 0

  return (
    <div className="img-multi">
      <div className="img-grid">
        {keepUrls.map((url, i) => (
          <div className="img-tile" key={`u-${i}`}>
            <img src={url} alt="" />
            <button
              type="button"
              className="img-remove"
              onClick={() => onRemoveUrl(i)}
              aria-label="Quitar imagen"
            >
              ✕
            </button>
          </div>
        ))}

        {newFiles.map((_, i) => (
          <div className="img-tile" key={`f-${i}`}>
            {previews[i] && <img src={previews[i]} alt="" />}
            <button
              type="button"
              className="img-remove"
              onClick={() => onRemoveFile(i)}
              aria-label="Quitar imagen"
            >
              ✕
            </button>
          </div>
        ))}

        {/* Tile para agregar más fotos */}
        <label className="img-add">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          <span>Agregar fotos</span>
          <input type="file" accept="image/*" multiple onChange={onInputChange} />
        </label>
      </div>

      {!hayImagenes && (
        <p className="img-hint">Elegí una o varias fotos de la galería del teléfono.</p>
      )}
    </div>
  )
}
