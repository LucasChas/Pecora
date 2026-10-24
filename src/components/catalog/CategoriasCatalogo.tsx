import { useEffect, useMemo, useRef } from 'react'
import type { ProductoConCategoria } from '../../types'
import { fotosPorCategoria } from '../../lib/filtrosCatalogo'
import Miniatura from '../common/Miniatura'

interface Props {
  categorias: string[] // nombres de categoría (sin incluir "Todos")
  activa: string
  onSelect: (categoria: string) => void
  // Para elegir la foto de cada categoría (la del primer producto con foto).
  productos: ProductoConCategoria[]
}

// Categorías de la portada: una sola fila con foto en círculo, que en el
// celular se desliza de costado. Antes eran chips de texto que en el celular
// bajaban a 7 renglones y tapaban los productos en la primera pantalla. La
// última foto queda cortada contra el borde: así se nota que hay más.
export default function CategoriasCatalogo({ categorias, activa, onSelect, productos }: Props) {
  const fotos = useMemo(() => fotosPorCategoria(productos), [productos])
  const opciones = ['Todos', ...categorias]
  const filaRef = useRef<HTMLUListElement>(null)

  // Si la categoría activa quedó fuera de la fila (ej. se entró por un link
  // con ?cat=), se desliza la fila hasta mostrarla. Solo la fila, no la página.
  useEffect(() => {
    const fila = filaRef.current
    const boton = fila?.querySelector<HTMLElement>('.categoria.activa')
    if (!fila || !boton) return
    const item = boton.parentElement as HTMLElement
    const margen = parseFloat(getComputedStyle(fila).paddingLeft) || 0
    const izq = item.offsetLeft - fila.offsetLeft
    const der = izq + item.offsetWidth
    if (izq < fila.scrollLeft + margen || der > fila.scrollLeft + fila.clientWidth - margen) {
      fila.scrollTo({ left: Math.max(0, izq - margen) })
    }
  }, [activa, categorias.length])

  return (
    <nav className="categorias" aria-label="Categorías">
      <ul className="categorias-fila" ref={filaRef}>
        {opciones.map((c) => {
          const activo = c === activa
          const foto = c === 'Todos' ? null : fotos.get(c)
          return (
            <li key={c}>
              <button
                type="button"
                className={activo ? 'categoria activa' : 'categoria'}
                aria-pressed={activo}
                onClick={() => onSelect(c)}
              >
                <span className="categoria-foto" aria-hidden="true">
                  {foto ? (
                    <Miniatura src={foto} alt="" width={128} height={128} />
                  ) : c === 'Todos' ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
                      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
                      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
                      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
                    </svg>
                  ) : (
                    <span className="categoria-inicial">{c.charAt(0)}</span>
                  )}
                </span>
                <span className="categoria-nombre">{c}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
