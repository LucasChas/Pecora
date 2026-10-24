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

// ---- Sugerencias del carrito ("Completá tu compra") --------------------------

export const MAXIMO_SUGERENCIAS_CARRITO = 2

// Palabras que no identifican una línea de diseño.
const PALABRAS_GENERICAS = new Set(['de', 'del', 'la', 'el', 'y', 'con', 'para', 'mini', 'baby', 'bebe'])

// "Set Selva Pink" -> ["selva", "pink"]: el nombre sin la primera palabra (el
// tipo de producto), en minúsculas, sin acentos ni comillas. Es la "línea" del
// diseño: Set, Babita y Portachupete "Selva" son de la misma.
export function palabrasDeLinea(nombre: string): string[] {
  const palabras = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/["'“”]/g, ' ')
    .split(/[^a-z0-9ñ]+/)
    .filter(Boolean)
  return palabras.slice(1).filter((p) => !PALABRAS_GENERICAS.has(p))
}

// Hasta 2 productos para sumar desde el carrito: primero los de la misma línea
// de diseño que algo del carrito (completar el set, sin otras variantes como
// "Pink"), después los de la misma categoría. Solo disponibles, sin talles (se agregan con un toque) y que no
// estén ya en el carrito. Sin relación con el carrito, no sugiere nada.
export function sugerenciasCarrito<
  T extends Pick<ProductoConCategoria, 'id' | 'nombre' | 'stock' | 'categoria_id'> & { talles?: unknown[] | null },
>(idsEnCarrito: readonly string[], todos: readonly T[], maximo = MAXIMO_SUGERENCIAS_CARRITO): T[] {
  const enCarrito = new Set(idsEnCarrito)
  const delCarrito = todos.filter((p) => enCarrito.has(p.id))
  if (delCarrito.length === 0) return []
  const lineas = new Set(delCarrito.flatMap((p) => palabrasDeLinea(p.nombre)))
  const categorias = new Set(delCarrito.map((p) => p.categoria_id).filter(Boolean))

  return todos
    .filter((p) => !enCarrito.has(p.id) && p.stock > 0 && !(Array.isArray(p.talles) && p.talles.length > 0))
    .map((p, orden) => {
      const palabras = palabrasDeLinea(p.nombre)
      const compartidas = palabras.filter((w) => lineas.has(w)).length
      // Las palabras de más restan: para "Set Selva", "Portachupete Selva"
      // va antes que "Set Selva Pink" (otra variante del mismo producto).
      const sobrantes = compartidas > 0 ? palabras.length - compartidas : 0
      const puntaje =
        compartidas * 10 - sobrantes * 3 + (p.categoria_id && categorias.has(p.categoria_id) ? 1 : 0)
      return { p, puntaje, orden }
    })
    .filter((x) => x.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje || a.orden - b.orden)
    .slice(0, maximo)
    .map((x) => x.p)
}
