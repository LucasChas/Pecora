import type { Talle, EntregaPedido, EstadoPedido, PedidoItem, ProductoConCategoria } from '../types'

// ============================================================================
// "Mis pedidos" de la clienta: línea de tiempo del estado y "Volver a
// comprar". Lógica pura (testeada en pedidoCliente.test.ts).
// ============================================================================

export type EstadoPaso = 'hecho' | 'actual' | 'pendiente'

export interface PasoPedido {
  clave: EstadoPedido
  texto: string
  estado: EstadoPaso
}

/**
 * Pasos del pedido para la línea de tiempo: Recibido → Confirmado →
 * (Enviado, solo con envío a domicilio) → Entregado. null si está cancelado
 * (ahí no hay camino que mostrar).
 */
export function pasosPedido(estado: EstadoPedido, entrega: EntregaPedido): PasoPedido[] | null {
  if (estado === 'cancelado') return null
  const pasos: { clave: EstadoPedido; texto: string }[] = [
    { clave: 'nuevo', texto: 'Recibido' },
    { clave: 'confirmado', texto: 'Confirmado' },
    ...(entrega === 'envio' ? [{ clave: 'enviado' as const, texto: 'Enviado' }] : []),
    { clave: 'entregado', texto: entrega === 'envio' ? 'Entregado' : 'Retirado' },
  ]
  // Un pedido a coordinar marcado "enviado" se muestra como confirmado.
  let actual = pasos.findIndex((p) => p.clave === estado)
  if (actual === -1) actual = pasos.findIndex((p) => p.clave === 'confirmado')
  return pasos.map((p, i) => ({
    ...p,
    estado: i < actual ? 'hecho' : i === actual ? (estado === 'entregado' ? 'hecho' : 'actual') : 'pendiente',
  }))
}

export interface Recompra {
  // Productos con stock, con la cantidad del pedido (el carrito la recorta
  // al stock disponible) y el talle, si el producto se vende por talle.
  agregar: { producto: ProductoConCategoria; cantidad: number; talle?: Talle | null }[]
  // Nombres de lo que hoy no se puede comprar (sin stock o ya no está).
  noDisponibles: string[]
}

/** Qué se puede volver a agregar al carrito de un pedido anterior. */
export function armarRecompra(
  items: readonly Pick<PedidoItem, 'id' | 'nombre' | 'cantidad' | 'talle_id'>[],
  productos: readonly ProductoConCategoria[],
): Recompra {
  const porId = new Map(productos.map((p) => [p.id, p]))
  // Una línea por producto y talle (sumando repetidos).
  const lineas = new Map<string, { id: string; talleId: string | null; nombre: string; cantidad: number }>()
  for (const i of items) {
    const talleId = i.talle_id || null
    const clave = talleId ? `${i.id}:${talleId}` : i.id
    const previo = lineas.get(clave)
    lineas.set(clave, {
      id: i.id,
      talleId,
      nombre: i.nombre,
      cantidad: (previo?.cantidad ?? 0) + Math.max(1, Math.trunc(i.cantidad)),
    })
  }
  const recompra: Recompra = { agregar: [], noDisponibles: [] }
  for (const { id, talleId, nombre, cantidad } of lineas.values()) {
    const producto = porId.get(id)
    if (!producto || !(producto.stock > 0)) {
      recompra.noDisponibles.push(nombre)
      continue
    }
    const talles = producto.talles ?? []
    if (talles.length === 0) {
      recompra.agregar.push({ producto, cantidad })
      continue
    }
    // Con talles: el mismo talle del pedido, si sigue existiendo con stock.
    const talle = talleId ? talles.find((t) => t.id === talleId) : undefined
    if (!talle || !(talle.stock > 0)) recompra.noDisponibles.push(nombre)
    else recompra.agregar.push({ producto, cantidad, talle })
  }
  return recompra
}

/** Mensaje después de "Volver a comprar". */
export function mensajeRecompra(r: Recompra): string {
  const n = r.agregar.length
  const agregados = n === 0 ? '' : n === 1 ? 'Agregamos 1 producto al carrito.' : `Agregamos ${n} productos al carrito.`
  if (r.noDisponibles.length === 0) return agregados
  const faltan =
    r.noDisponibles.length === 1
      ? `${r.noDisponibles[0]} no tiene stock ahora.`
      : `${r.noDisponibles.length} productos no tienen stock ahora.`
  return n === 0 ? `Ninguno de estos productos tiene stock ahora.` : `${agregados} ${faltan}`
}

/** Productos actuales (con categoría) para "Volver a comprar". [] si falla. */
export async function cargarProductosPorId(ids: readonly string[]): Promise<ProductoConCategoria[]> {
  if (ids.length === 0) return []
  try {
    const { supabase } = await import('./supabaseClient')
    const { aplanarProducto, conTalles } = await import('./productosConsulta')
    const { data, error } = await conTalles((select) => supabase.from('productos').select(select).in('id', [...ids]))
    if (error) return []
    return ((data as unknown[]) ?? []).map(aplanarProducto)
  } catch {
    return []
  }
}
