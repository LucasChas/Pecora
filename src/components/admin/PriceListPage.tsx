import { useId, type ReactNode } from 'react'
import Logo from '../Logo'

interface Props {
  // La primera hoja lleva el header grande; las siguientes, el chico.
  primera: boolean
  numero: number
  total: number
  mesAnio: string
  sitio: string
  // Solo para medir: la hoja crece con su contenido en vez de ser A4 fija.
  medir?: boolean
  children?: ReactNode
}

// Una hoja A4 de la lista de precios: header, festón, cuerpo (bandas) y pie.
// Presentacional: qué bandas van en cada hoja lo decide CatalogExport.
export default function PriceListPage({
  primera,
  numero,
  total,
  mesAnio,
  sitio,
  medir = false,
  children,
}: Props) {
  const clases = ['ce-page', primera && 'ce-page--primera', medir && 'ce-page--medir']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={clases}>
      {primera ? (
        <header className="ce-header ce-header--big">
          <Logo className="ce-logo" />
          <p className="ce-tag">Lista de precios</p>
          <p className="ce-tag2">Accesorios textiles para bebés</p>
        </header>
      ) : (
        <header className="ce-header ce-header--small">
          <Logo className="ce-logo" />
          <p className="ce-tag">Lista de precios</p>
        </header>
      )}

      <Festoneado />

      <div className="ce-main">{children}</div>

      <footer className="ce-footer">
        <span>Precios vigentes · {mesAnio} · Medidas aproximadas</span>
        <span>
          Ver fotos y hacer pedidos: <b>{sitio}</b>
        </span>
        <span>
          {numero}/{total}
        </span>
      </footer>
    </div>
  )
}

// Festón en SVG (igual que la plantilla). El id del patrón es único por hoja
// para no repetir ids en el documento. En la hoja se estira al ancho del A4
// (viewBox de 794). Con `natural` (lista del celular) no hay viewBox: el
// patrón se repite a su tamaño real y no se deforma en una pantalla angosta.
export function Festoneado({ natural = false }: { natural?: boolean }) {
  const patron = `ce-feston-${useId().replace(/:/g, '')}`
  const lienzo = natural ? {} : { viewBox: '0 0 794 14', preserveAspectRatio: 'none' }
  return (
    <svg className="ce-scallop" {...lienzo} aria-hidden="true">
      <defs>
        <pattern id={patron} width="16" height="14" patternUnits="userSpaceOnUse">
          <path d="M0 2 Q4 12 8 2 Q12 12 16 2" fill="none" stroke="#B08F55" strokeWidth="2" />
        </pattern>
      </defs>
      <rect width={natural ? '100%' : '794'} height="14" fill={`url(#${patron})`} />
    </svg>
  )
}
