import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProductoConCategoria } from '../../types'
import { useProducts } from '../../hooks/useProducts'
import { elegirRelacionados } from '../../lib/relacionados'
import ProductCard from './ProductCard'

// Estado de navegación (location.state) con el que se abre una ficha.
// desdeCatalogo: se llegó navegando desde el muestrario (sin recargar);
// pasosAlMuestrario: cuántas entradas del historial hay que retroceder para
// volver a él (1 desde una card del muestrario, +1 por cada relacionado).
export interface EstadoFicha {
  desdeCatalogo?: boolean
  pasosAlMuestrario?: number
}

interface Props {
  producto: ProductoConCategoria
  // Estado con el que se abren las fichas de los relacionados (lo arma ProductPage).
  estadoLink: EstadoFicha | null
}

// "También te puede gustar": se muestra debajo de la ficha. Usa la lista de
// useProducts (caché de módulo → instantánea si se viene del muestrario). En
// un arranque en frío, mientras carga o si falla, la sección no aparece.
export default function RelatedProducts({ producto, estadoLink }: Props) {
  const { productos } = useProducts()
  const navigate = useNavigate()
  const relacionados = useMemo(
    () => elegirRelacionados(producto, productos),
    [producto, productos],
  )

  if (relacionados.length === 0) return null

  // ProductCard marca sus links con { desdeCatalogo: true }, pensado para el
  // muestrario. Desde acá eso rompería el "Volver al muestrario" de la ficha
  // siguiente (haría un atrás a ESTA ficha), así que el click normal se
  // intercepta y se navega con el estado que corresponde. Ctrl/Cmd/Shift +
  // click (abrir en otra pestaña) sigue siendo un link común.
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const link = (e.target as Element).closest<HTMLAnchorElement>('a.card-open')
    const destino = link?.getAttribute('href')
    if (!destino) return
    e.preventDefault()
    navigate(destino, { state: estadoLink })
  }

  return (
    <section className="related" aria-labelledby="related-title">
      <h2 className="related-title" id="related-title">
        También te puede gustar
      </h2>
      <div className="grid related-grid" onClickCapture={onClickCapture}>
        {relacionados.map((p) => (
          <ProductCard key={p.id} producto={p} />
        ))}
      </div>
    </section>
  )
}
