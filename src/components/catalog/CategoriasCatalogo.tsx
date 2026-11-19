import { Fragment, useMemo } from 'react'
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

// Categorías de la portada. Se ven todas de una, sin deslizar de costado:
// - Tablet/desktop: fotos en círculo en renglones centrados.
// - Celular (≤720px): "pastillas" compactas (foto chica + nombre) que se
//   acomodan en renglones según el largo del nombre; ocupan mucho menos alto
//   que los círculos y ningún nombre largo se pisa con el de al lado.
export default function CategoriasCatalogo({ categorias, activa, onSelect, productos }: Props) {
  const fotos = useMemo(() => fotosPorCategoria(productos), [productos])
  const opciones = ['Todos', ...categorias]

  return (
    <nav className="categorias" aria-label="Categorías">
      <ul className="categorias-fila">
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
                <span className="categoria-nombre">{conCortes(c)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

// Permite cortar el renglón después de "/" o "-" (ej. "Mordillos/<corte>Sonajeros"):
// sin esto una palabra larga sin espacios no entra y se encima con la vecina.
function conCortes(nombre: string) {
  const partes = nombre.split(/(?<=[/-])/)
  if (partes.length === 1) return nombre
  return partes.map((p, i) => (
    <Fragment key={i}>
      {i > 0 && <wbr />}
      {p}
    </Fragment>
  ))
}
