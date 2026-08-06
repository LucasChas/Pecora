import { Fragment } from 'react'

interface Props {
  categorias: string[] // nombres de categoría (sin incluir "Todos")
  activa: string
  onSelect: (categoria: string) => void
  // Cuando se pasa, se usa como clase de cada botón (ej. "chip", que junto a
  // "active" reproduce el patrón "chip"/"chip active" de admin) y se omite
  // el wrap "filters" propio del catálogo — el contenedor lo pone quien
  // reusa el componente (ej. AdminPage con "orders-chips").
  className?: string
}

// Chips de filtro por categoría. Se generan dinámicamente a partir de la
// tabla categorias; "Todos" siempre va primero.
export default function CategoryFilters({ categorias, activa, onSelect, className }: Props) {
  const opciones = ['Todos', ...categorias]
  const Wrap = className ? Fragment : 'div'
  const wrapProps = className ? {} : { className: 'filters' }

  return (
    <Wrap {...wrapProps}>
      {opciones.map((c) => {
        const isActive = c === activa
        const clase = className
          ? isActive
            ? `${className} active`
            : className
          : isActive
            ? 'active'
            : ''
        return (
          <button key={c} className={clase} onClick={() => onSelect(c)}>
            {c}
          </button>
        )
      })}
    </Wrap>
  )
}
