import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useDialog } from '../../context/DialogContext'
import { useFavoritos } from '../../context/FavoritosContext'

// Corazón de favoritos (cards y ficha). Sin sesión lleva a ingresar y vuelve
// a la misma página; si la función no está disponible en la base, no se ve.
export default function BotonFavorito({
  productoId,
  nombre,
  variante = 'card',
}: {
  productoId: string
  nombre: string
  variante?: 'card' | 'ficha'
}) {
  const { session, loading } = useAuth()
  const { ids, esFavorito, alternar } = useFavoritos()
  const { notificar } = useDialog()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()

  if (loading || (session && ids === null)) return null
  const activo = esFavorito(productoId)

  async function onClick(e: React.MouseEvent) {
    // En la card el botón está sobre la foto (que es un link): no abrir la ficha.
    e.preventDefault()
    e.stopPropagation()
    if (!session) {
      navigate(`/cuenta?next=${encodeURIComponent(pathname + search)}`)
      return
    }
    const ok = await alternar(productoId)
    if (!ok) notificar('No pudimos guardar el favorito. Probá de nuevo.')
    else if (variante === 'ficha') notificar(activo ? 'Lo sacamos de tus favoritos' : 'Guardado en tus favoritos')
  }

  return (
    <button
      type="button"
      className={`fav-btn fav-btn--${variante}${activo ? ' fav-btn--activo' : ''}`}
      onClick={onClick}
      aria-pressed={activo}
      aria-label={activo ? `Quitar ${nombre} de favoritos` : `Guardar ${nombre} en favoritos`}
      title={activo ? 'Quitar de favoritos' : 'Guardar en favoritos'}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20.5s-7.5-4.4-9.3-9.2C1.6 8.2 3.6 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.6 0 5.6 3.7 4.5 6.8-1.8 4.8-9.3 9.2-9.3 9.2z" />
      </svg>
      {variante === 'ficha' && <span>{activo ? 'En favoritos' : 'Guardar'}</span>}
    </button>
  )
}
