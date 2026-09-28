import type { ProductoConCategoria } from '../types'

// ============================================================================
// Selección de "También te puede gustar" (lo muestra RelatedProducts debajo
// de la ficha). Lógica pura, sin React, para poder testearla.
// ============================================================================

export const MAXIMO_RELACIONADOS = 4

// Pone primero los disponibles (stock > 0) sin cambiar el orden relativo.
function disponiblesPrimero(lista: ProductoConCategoria[]): ProductoConCategoria[] {
  return [...lista.filter((p) => p.stock > 0), ...lista.filter((p) => p.stock <= 0)]
}

// Regla de selección: hasta 4 productos de la misma categoría (sin el actual),
// disponibles primero. Si la categoría tiene menos de 2 productos más, se
// completa con otros disponibles de cualquier categoría.
export function elegirRelacionados(
  actual: ProductoConCategoria,
  todos: ProductoConCategoria[],
): ProductoConCategoria[] {
  const otros = todos.filter((p) => p.id !== actual.id)
  const mismaCategoria = actual.categoria_id
    ? otros.filter((p) => p.categoria_id === actual.categoria_id)
    : []
  const elegidos = disponiblesPrimero(mismaCategoria).slice(0, MAXIMO_RELACIONADOS)
  if (mismaCategoria.length >= 2) return elegidos

  const ya = new Set(elegidos.map((p) => p.id))
  const relleno = otros.filter((p) => p.stock > 0 && !ya.has(p.id))
  return [...elegidos, ...relleno].slice(0, MAXIMO_RELACIONADOS)
}
