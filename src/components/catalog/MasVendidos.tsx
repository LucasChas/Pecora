import { useEffect, useMemo, useState } from 'react'
import type { ProductoConCategoria } from '../../types'
import {
  MINIMO_MAS_VENDIDOS,
  cargarMasVendidos,
  resolverMasVendidos,
  type MasVendido,
} from '../../lib/masVendidos'
import ProductCard from './ProductCard'

interface Props {
  // Lista del muestrario (useProducts de CatalogPage): se reusa para no abrir
  // otro canal de Realtime y para que precio/stock estén siempre al día.
  productos: ProductoConCategoria[]
}

// "Lo más vendido": fila destacada arriba de la grilla del muestrario. Si la
// RPC falla, todavía no existe o hay menos de 3 productos para mostrar, la
// sección directamente no aparece (no hay estado de error visible).
export default function MasVendidos({ productos }: Props) {
  const [ranking, setRanking] = useState<MasVendido[] | null>(null)

  useEffect(() => {
    let vigente = true
    cargarMasVendidos().then((r) => {
      if (vigente && r.ok) setRanking(r.filas)
    })
    return () => {
      vigente = false
    }
  }, [])

  const destacados = useMemo(
    () => (ranking ? resolverMasVendidos(ranking, productos) : []),
    [ranking, productos],
  )

  if (destacados.length < MINIMO_MAS_VENDIDOS) return null

  return (
    <section className="mas-vendidos" aria-labelledby="mas-vendidos-title">
      <h2 className="mas-vendidos-title" id="mas-vendidos-title">
        Lo más vendido
      </h2>
      <div className="grid mas-vendidos-grid">
        {destacados.map((p) => (
          <ProductCard key={p.id} producto={p} />
        ))}
      </div>
    </section>
  )
}
