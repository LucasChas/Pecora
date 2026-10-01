import { useEffect, useId, useRef } from 'react'
import type { MiResena } from '../../types'
import { FormularioResena } from '../catalog/ResenasProducto'
import { useCerrarConAtras } from '../../hooks/useCerrarConAtras'
import '../../styles/resenas.css'

interface Props {
  productoId: string
  nombre: string
  imagen: string
  inicial: MiResena | null
  onGuardada: () => void
  onClose: () => void
}

// Ventana para calificar (o editar la reseña de) un producto comprado, desde
// "Mis pedidos". Usa el mismo formulario que la ficha del producto, así que
// las reglas (estrellas, largo del comentario, compra verificada) son las
// mismas. Escape, tocar afuera o el botón Atrás del celular la cierran.
export default function CalificarProducto({ productoId, nombre, imagen, inicial, onGuardada, onClose }: Props) {
  const tituloId = useId()
  const cardRef = useRef<HTMLDivElement>(null)

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useCerrarConAtras(true, () => onCloseRef.current())

  // Foco adentro al abrir y de vuelta al botón que la abrió al cerrar.
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null
    cardRef.current?.focus()
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('keydown', alTeclear)
      anterior?.focus?.()
    }
  }, [])

  return (
    <div
      className="dlg-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="dlg-card calificar-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        ref={cardRef}
      >
        <div className="calificar-cabecera">
          <img className="calificar-img" src={imagen} alt="" />
          <div>
            <p className="calificar-sub">{inicial ? 'Editá tu reseña' : '¿Qué te pareció?'}</p>
            <h2 className="dlg-titulo" id={tituloId}>
              {nombre}
            </h2>
          </div>
          <button type="button" className="calificar-cerrar" onClick={onClose} aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <FormularioResena productoId={productoId} inicial={inicial} onGuardada={onGuardada} onCancelar={onClose} />
      </div>
    </div>
  )
}
