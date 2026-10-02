import { useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProductoConCategoria } from '../../types'
import { money } from '../../lib/format'
import { portadaDe } from '../../lib/images'
import { sugerencias } from '../../lib/filtrosCatalogo'
import Miniatura from '../common/Miniatura'

interface Props {
  value: string
  onChange: (valor: string) => void
  productos: ProductoConCategoria[]
}

// Buscador del muestrario con sugerencias: mientras se escribe, filtra la
// grilla (como antes) y debajo muestra hasta 5 productos que coinciden. Con
// flechas se elige uno y Enter lo abre; Escape cierra la lista.
export default function BuscadorCatalogo({ value, onChange, productos }: Props) {
  const navigate = useNavigate()
  const listaId = useId()
  const [abierta, setAbierta] = useState(false)
  const [activa, setActiva] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  const opciones = useMemo(() => sugerencias(productos, value, 5), [productos, value])
  const mostrar = abierta && opciones.length > 0

  function abrir(p: ProductoConCategoria) {
    setAbierta(false)
    inputRef.current?.blur()
    navigate(`/producto/${p.slug ?? p.id}`, { state: { desdeCatalogo: true } })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setAbierta(false)
      return
    }
    if (!mostrar) {
      if (e.key === 'ArrowDown' && opciones.length) setAbierta(true)
      if (e.key === 'Enter') inputRef.current?.blur()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiva((i) => (i + 1) % opciones.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiva((i) => (i <= 0 ? opciones.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activa >= 0) abrir(opciones[activa])
      else {
        // Enter sin elegir: queda la grilla filtrada (se cierra el teclado).
        setAbierta(false)
        inputRef.current?.blur()
      }
    }
  }

  return (
    <div className="search-wrap">
      <div className="search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          enterKeyHint="search"
          aria-label="Buscar productos"
          placeholder="Buscar en el muestrario..."
          role="combobox"
          aria-expanded={mostrar}
          aria-controls={listaId}
          aria-autocomplete="list"
          aria-activedescendant={mostrar && activa >= 0 ? `${listaId}-${activa}` : undefined}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setAbierta(true)
            setActiva(-1)
          }}
          onFocus={() => setAbierta(true)}
          // Con demora: el toque en una sugerencia tiene que llegar antes.
          onBlur={() => window.setTimeout(() => setAbierta(false), 150)}
          onKeyDown={onKeyDown}
        />
        {mostrar && (
          <ul className="search-sugerencias" id={listaId} role="listbox" aria-label="Sugerencias">
            {opciones.map((p, i) => (
              <li
                key={p.id}
                id={`${listaId}-${i}`}
                role="option"
                aria-selected={i === activa}
                className={i === activa ? 'activa' : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => abrir(p)}
                onMouseEnter={() => setActiva(i)}
              >
                <Miniatura src={portadaDe(p)} alt="" width={44} height={44} loading="lazy" />
                <span className="sug-texto">
                  <span className="sug-nombre">{p.nombre}</span>
                  <span className="sug-detalle">
                    {p.categoria_nombre ? `${p.categoria_nombre} · ` : ''}
                    {p.stock > 0 ? money(p.precio) : 'Agotado'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
