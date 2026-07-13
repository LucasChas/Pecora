import { useEffect, useState } from 'react'

interface Props {
  // URL de la imagen ya guardada (al editar). Puede ser null en un alta.
  imagenActual: string | null
  // Notifica al formulario el archivo elegido (o null si no se cambió).
  onFileSelected: (file: File | null) => void
}

// Selector de imagen pensado para el celular: abre la GALERÍA de fotos
// (sin el atributo capture, para que no vaya directo a la cámara) y muestra
// una vista previa antes de guardar. El archivo se sube a Supabase Storage
// recién al guardar el producto (lo hace ProductFormSheet), no acá.
export default function ImagePicker({ imagenActual, onFileSelected }: Props) {
  const [preview, setPreview] = useState<string | null>(imagenActual)

  // Si cambia la imagen actual (p. ej. al abrir la hoja para otro producto),
  // reseteamos la vista previa.
  useEffect(() => {
    setPreview(imagenActual)
  }, [imagenActual])

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    onFileSelected(file)
    if (file) {
      // Vista previa local inmediata (sin subir todavía).
      const reader = new FileReader()
      reader.onload = () => setPreview(reader.result as string)
      reader.readAsDataURL(file)
    }
  }

  return (
    <label className={preview ? 'image-picker has-img' : 'image-picker'}>
      {preview && <img src={preview} alt="" />}
      <div className="hint">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path d="M4 8a2 2 0 0 1 2-2h1.2a1 1 0 0 0 .9-.55l.4-.8A2 2 0 0 1 10.3 3.5h3.4a2 2 0 0 1 1.8 1.15l.4.8a1 1 0 0 0 .9.55H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
          <circle cx="12" cy="12.5" r="3.4" />
        </svg>
        <span>
          Tocá para elegir una foto
          <br />de la galería
        </span>
      </div>
      <span className="retake">Cambiar foto</span>
      <input type="file" accept="image/*" onChange={onChange} />
    </label>
  )
}
