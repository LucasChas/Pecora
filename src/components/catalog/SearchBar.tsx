interface Props {
  value: string
  onChange: (valor: string) => void
}

// Buscador del catálogo. Filtra por nombre, descripción y categoría
// (la lógica de filtrado vive en CatalogPage).
export default function SearchBar({ value, onChange }: Props) {
  return (
    <div className="search-wrap">
      <div className="search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="text"
          placeholder="Buscar en el muestrario..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}
