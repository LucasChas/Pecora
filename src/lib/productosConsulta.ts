// Consulta de productos con su categoría y sus talles (migración *_talles).
//
// Si la base todavía no tiene la tabla producto_talles, PostgREST rechaza el
// join: se reintenta sin talles y se recuerda, así la tienda sigue andando
// igual que antes de la migración.

import type { ProductoConCategoria, Talle } from '../types'

export const SELECT_CON_TALLES = '*, categorias(nombre), producto_talles(id, talle, stock, orden)'
export const SELECT_SIN_TALLES = '*, categorias(nombre)'

let sinTablaTalles = false

interface RespuestaPostgrest {
  data: unknown
  error: { message: string; code?: string } | null
}

/** El error es por la relación/tabla de talles que todavía no existe. */
export function esFaltaTalles(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false
  return (
    error.code === 'PGRST200' ||
    error.code === '42P01' ||
    /producto_talles/i.test(error.message ?? '')
  )
}

/** Talles ordenados (orden y después nombre), sin filas raras. */
export function ordenarTalles(raw: unknown): Talle[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((t): t is Talle => !!t && typeof t === 'object' && typeof (t as Talle).id === 'string')
    .map((t) => ({ id: t.id, talle: String(t.talle), stock: Number(t.stock) || 0, orden: Number(t.orden) || 0 }))
    .sort((a, b) => a.orden - b.orden || a.talle.localeCompare(b.talle, 'es', { numeric: true }))
}

/** Aplana el join: categorias.nombre → categoria_nombre, producto_talles → talles. */
export function aplanarProducto(row: unknown): ProductoConCategoria {
  const { categorias, producto_talles, ...resto } = row as Record<string, unknown> & {
    categorias: { nombre: string } | null
    producto_talles?: unknown
  }
  const talles = ordenarTalles(producto_talles)
  return {
    ...(resto as unknown as ProductoConCategoria),
    categoria_nombre: categorias?.nombre ?? null,
    talles,
  }
}

/**
 * Corre la consulta con talles y, si la tabla no existe, sin talles.
 * `armar` recibe el select a usar y devuelve la consulta de supabase-js.
 */
export async function conTalles(
  armar: (select: string) => PromiseLike<RespuestaPostgrest>,
): Promise<RespuestaPostgrest> {
  if (!sinTablaTalles) {
    const r = await armar(SELECT_CON_TALLES)
    if (!esFaltaTalles(r.error)) return r
    sinTablaTalles = true
  }
  return armar(SELECT_SIN_TALLES)
}

/** El producto se vende por talle. */
export function tieneTalles(p: { talles?: Talle[] | null }): boolean {
  return Array.isArray(p.talles) && p.talles.length > 0
}
