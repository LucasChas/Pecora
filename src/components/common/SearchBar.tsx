interface Props {
  value: string
  onChange: (valor: string) => void
  placeholder?: string
  // Cuando se pasa, reemplaza el markup del catálogo (ícono + wrap) por un
  // input suelto con esta clase — permite reusar el componente en admin con
  // su propio lenguaje visual (ej. "orders-search") sin duplicar el input.
  className?: string
}

// Buscador reutilizable. En el catálogo filtra por nombre/descripción/categoría
// (la lógica de filtrado vive en CatalogPage); en admin filtra productos
// (la lógica vive en AdminPage).
export default function SearchBar({
  value,
  onChange,
  placeholder = 'Buscar en el muestrario...',
  className,
}: Props) {
  if (className) {
    return (
      <input
        type="search"
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  return (
    <div className="search-wrap">
      <div className="search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}
