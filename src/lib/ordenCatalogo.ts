import type { Producto } from '../types'

// Orden del muestrario (?orden= en la URL).
export type OrdenCatalogo = 'novedades' | 'precio-asc' | 'precio-desc'

export const OPCIONES_ORDEN: { valor: OrdenCatalogo; texto: string }[] = [
  { valor: 'novedades', texto: 'Novedades' },
  { valor: 'precio-asc', texto: 'Menor precio' },
  { valor: 'precio-desc', texto: 'Mayor precio' },
]

export function ordenDeUrl(valor: string | null): OrdenCatalogo {
  return OPCIONES_ORDEN.some((o) => o.valor === valor) ? (valor as OrdenCatalogo) : 'novedades'
}

// Ordena sin mutar. Los productos sin stock van siempre al final (antes
// quedaban mezclados con los disponibles); dentro de cada grupo, según el
// orden elegido. "Novedades" respeta el orden de llegada (más nuevos primero).
export function ordenarCatalogo<T extends Pick<Producto, 'stock' | 'precio' | 'created_at'>>(
  productos: T[],
  orden: OrdenCatalogo,
): T[] {
  const criterio = (a: T, b: T): number => {
    if (orden === 'precio-asc') return a.precio - b.precio
    if (orden === 'precio-desc') return b.precio - a.precio
    return b.created_at.localeCompare(a.created_at)
  }
  return [...productos].sort((a, b) => {
    const sinStock = Number(a.stock <= 0) - Number(b.stock <= 0)
    return sinStock !== 0 ? sinStock : criterio(a, b)
  })
}
