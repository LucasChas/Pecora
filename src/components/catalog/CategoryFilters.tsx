interface Props {
  categorias: string[] // nombres de categoría (sin incluir "Todos")
  activa: string
  onSelect: (categoria: string) => void
}

// Chips de filtro por categoría. Se generan dinámicamente a partir de la
// tabla categorias; "Todos" siempre va primero.
export default function CategoryFilters({ categorias, activa, onSelect }: Props) {
  const opciones = ['Todos', ...categorias]
  return (
    <div className="filters">
      {opciones.map((c) => (
        <button
          key={c}
          className={c === activa ? 'active' : ''}
          onClick={() => onSelect(c)}
        >
          {c}
        </button>
      ))}
    </div>
  )
}
