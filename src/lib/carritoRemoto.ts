// Carrito guardado en la cuenta (tabla `carritos`, migración *_avisos_tienda).
//
// Sirve para dos cosas: que el carrito siga ahí si la clienta entra desde otro
// dispositivo, y que la tienda pueda mandarle un recordatorio si lo deja
// abandonado. En la base solo va { id, cantidad }; el resto (precio, foto,
// stock) se lee del producto al recuperarlo.
//
// Nunca rompe el carrito local: si la tabla todavía no existe o no hay red,
// todo sigue funcionando como antes (solo en este dispositivo).

import type { CartItem } from '../context/CartContext'
import type { ProductoConCategoria } from '../types'
import { portadaDe } from './images'

export interface ItemGuardado {
  id: string
  cantidad: number
  // Talle elegido (productos con talles).
  talle_id?: string
}

const claveGuardado = (i: { id: string; talle_id?: string | null }) => (i.talle_id ? `${i.id}:${i.talle_id}` : i.id)

/** Lo que se guarda en la base: id y cantidad, sin duplicados ni basura. */
export function aGuardar(items: readonly CartItem[]): ItemGuardado[] {
  const vistos = new Set<string>()
  const res: ItemGuardado[] = []
  for (const i of items) {
    const clave = claveGuardado({ id: i.id, talle_id: i.talleId })
    if (!i.id || vistos.has(clave) || !(i.cantidad > 0)) continue
    vistos.add(clave)
    res.push({ id: i.id, cantidad: Math.floor(i.cantidad), ...(i.talleId ? { talle_id: i.talleId } : {}) })
  }
  return res.slice(0, 50)
}

/** Firma estable para no guardar dos veces lo mismo. */
export function firma(items: readonly ItemGuardado[]): string {
  return items.map((i) => `${claveGuardado(i)}:${i.cantidad}`).join('|')
}

/** Lee la columna items tal como venga de la base. */
export function leerGuardados(raw: unknown): ItemGuardado[] {
  if (!Array.isArray(raw)) return []
  const res: ItemGuardado[] = []
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const cantidad = typeof o.cantidad === 'number' ? Math.floor(o.cantidad) : 0
    if (typeof o.id === 'string' && o.id && cantidad > 0) {
      res.push({ id: o.id, cantidad, ...(typeof o.talle_id === 'string' && o.talle_id ? { talle_id: o.talle_id } : {}) })
    }
  }
  return res
}

/**
 * Rearma el carrito con los datos actuales de cada producto. Los que ya no
 * existen o están agotados quedan afuera; la cantidad no supera el stock.
 */
export function rearmarCarrito(
  guardados: readonly ItemGuardado[],
  productos: readonly ProductoConCategoria[],
): CartItem[] {
  const porId = new Map(productos.map((p) => [p.id, p]))
  const res: CartItem[] = []
  for (const g of guardados) {
    const p = porId.get(g.id)
    if (!p) continue
    const talles = p.talles ?? []
    // Con talles, la línea necesita su talle (y vale el stock de ese talle).
    const talle = talles.length > 0 ? talles.find((t) => t.id === g.talle_id) : undefined
    if (talles.length > 0 && !talle) continue
    const stock = talle ? talle.stock : p.stock
    if (!(stock > 0)) continue
    res.push({
      id: p.id,
      nombre: p.nombre,
      precio: p.precio,
      imagen: portadaDe(p),
      stock,
      cantidad: Math.min(g.cantidad, stock),
      slug: p.slug,
      ...(talle ? { talleId: talle.id, talle: talle.talle } : {}),
    })
  }
  return res
}

export async function leerCarritoRemoto(userId: string): Promise<ItemGuardado[] | null> {
  try {
    const { supabase } = await import('./supabaseClient')
    const { data, error } = await supabase.from('carritos').select('items').eq('user_id', userId).maybeSingle()
    if (error) return null
    return leerGuardados(data?.items)
  } catch {
    return null
  }
}

export async function guardarCarritoRemoto(userId: string, items: readonly ItemGuardado[]): Promise<void> {
  try {
    const { supabase } = await import('./supabaseClient')
    if (items.length === 0) {
      await supabase.from('carritos').delete().eq('user_id', userId)
    } else {
      await supabase.from('carritos').upsert({ user_id: userId, items }, { onConflict: 'user_id' })
    }
  } catch {
    // Sin red o sin la tabla: el carrito local sigue andando.
  }
}
