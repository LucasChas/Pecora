import { useEffect } from 'react'

// Overlay de zoom nativo: se apoya en el pinch-zoom del navegador dentro de
// un contenedor scrolleable (touch-action: pinch-zoom), sin librería de zoom.
// Se abre al tocar/clickear la imagen de un tile en ImagePicker y muestra la
// imagen a tamaño natural para permitir pinch (touch) y scroll, así el admin
// puede inspeccionar calidad/detalle de la foto mientras gestiona el producto.
export default function ImageZoom({
  src,
  alt,
  onClose,
}: {
  src: string
  alt: string
  onClose: () => void
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="image-zoom-overlay" role="dialog" aria-modal="true" aria-label="Zoom de imagen">
      <button
        type="button"
        className="image-zoom-close"
        onClick={onClose}
        aria-label="Cerrar zoom"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
      <div className="image-zoom-scroll">
        <img src={src} alt={alt} className="image-zoom-img" />
      </div>
    </div>
  )
}
