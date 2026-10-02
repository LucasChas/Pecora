// Talles de un producto en el panel (tabla producto_talles, migración *_talles).
// La parte pura (validar y armar el plan de cambios) está separada de la que
// escribe en la base, para poder testearla.

import type { Talle } from '../types'

export interface FilaTalle {
  // Clave estable para React (las filas nuevas no tienen id todavía).
  key: string
  id?: string
  talle: string
  stock: string
}

// Talles de bebé más usados: botón "Cargar talles de bebé" del formulario.
export const TALLES_BEBE = ['RN', '0-3 m', '3-6 m', '6-9 m', '9-12 m', '12-18 m', '18-24 m']

let secuencia = 0
export function nuevaFila(talle = '', stock = ''): FilaTalle {
  return { key: `nueva-${++secuencia}`, talle, stock }
}

export function filasDe(talles: readonly Talle[] | null | undefined, conIds = true): FilaTalle[] {
  return (talles ?? []).map((t) => ({
    key: conIds ? t.id : `copia-${++secuencia}`,
    ...(conIds ? { id: t.id } : {}),
    talle: t.talle,
    stock: conIds ? String(t.stock) : '',
  }))
}

/** Suma del stock de las filas (lo que va a quedar como stock del producto). */
export function stockTotal(filas: readonly FilaTalle[]): number {
  return filas.reduce((n, f) => n + (Number(f.stock) > 0 ? Math.floor(Number(f.stock)) : 0), 0)
}

/** null si las filas sirven; si no, el mensaje para mostrar. */
export function validarFilas(filas: readonly FilaTalle[]): string | null {
  if (filas.length === 0) return 'Agregá al menos un talle (o desmarcá "Este producto tiene talles").'
  const vistos = new Set<string>()
  for (const f of filas) {
    const nombre = f.talle.trim()
    if (!nombre) return 'Hay un talle sin nombre.'
    if (nombre.length > 30) return `El talle "${nombre.slice(0, 30)}…" es muy largo (máximo 30 letras).`
    const clave = nombre.toLowerCase()
    if (vistos.has(clave)) return `El talle "${nombre}" está repetido.`
    vistos.add(clave)
    const n = Number(f.stock)
    if (f.stock.trim() === '' || !Number.isInteger(n) || n < 0) {
      return `Revisá el stock del talle "${nombre}" (un número entero, 0 o más).`
    }
  }
  return null
}

export interface PlanTalles {
  borrar: string[]
  actualizar: { id: string; talle: string; stock: number; orden: number; stockAntes: number }[]
  crear: { talle: string; stock: number; orden: number }[]
}

/** Qué hay que borrar, cambiar y crear para pasar de `originales` a `filas`. */
export function planTalles(originales: readonly Talle[], filas: readonly FilaTalle[]): PlanTalles {
  const porId = new Map(originales.map((t) => [t.id, t]))
  const quedan = new Set(filas.filter((f) => f.id).map((f) => f.id as string))
  const plan: PlanTalles = {
    borrar: originales.filter((t) => !quedan.has(t.id)).map((t) => t.id),
    actualizar: [],
    crear: [],
  }
  filas.forEach((f, orden) => {
    const talle = f.talle.trim()
    const stock = Math.floor(Number(f.stock))
    const original = f.id ? porId.get(f.id) : undefined
    if (!original) {
      plan.crear.push({ talle, stock, orden })
    } else if (original.talle !== talle || original.stock !== stock || original.orden !== orden) {
      plan.actualizar.push({ id: original.id, talle, stock, orden, stockAntes: original.stock })
    }
  })
  return plan
}

export type ResultadoTalles = { ok: true } | { ok: false; error: string }

/**
 * Aplica el plan. El stock de cada talle se cambia solo si sigue siendo el que
 * se leyó (como guardarProductoSinPisarStock): si entró una venta mientras se
 * editaba, no se la pisa y se avisa.
 */
export async function guardarTalles(productoId: string, plan: PlanTalles): Promise<ResultadoTalles> {
  const { supabase } = await import('./supabaseClient')
  // Primero los borrados (así un talle renombrado a uno que se borra no choca
  // con el índice único).
  if (plan.borrar.length > 0) {
    const { error } = await supabase.from('producto_talles').delete().in('id', plan.borrar)
    if (error) return { ok: false, error: error.message }
  }
  for (const a of plan.actualizar) {
    const { data, error } = await supabase
      .from('producto_talles')
      .update({ talle: a.talle, stock: a.stock, orden: a.orden })
      .eq('id', a.id)
      .eq('stock', a.stockAntes)
      .select('id')
    if (error) return { ok: false, error: error.message }
    if (!data || data.length === 0) {
      return {
        ok: false,
        error: `El stock del talle "${a.talle}" cambió mientras editabas (entró una venta). Cerrá y volvé a abrir el producto para ver el stock actual.`,
      }
    }
  }
  if (plan.crear.length > 0) {
    const { error } = await supabase
      .from('producto_talles')
      .insert(plan.crear.map((c) => ({ ...c, producto_id: productoId })))
    if (error) return { ok: false, error: error.message }
  }
  return { ok: true }
}
