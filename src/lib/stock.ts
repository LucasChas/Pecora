import { supabase } from './supabaseClient'

// Umbral para avisar "pocas unidades" en el catálogo.
export const STOCK_BAJO = 3

// Mensaje de stock bajo para mostrar en la card / detalle (o null si no aplica).
// Solo tiene sentido cuando hay stock (> 0).
export function avisoStockBajo(stock: number): string | null {
  if (stock <= 0) return null
  if (stock === 1) return '¡Último disponible!'
  if (stock <= STOCK_BAJO) return `¡Últimas ${stock} unidades!`
  return null
}

// ---------------------------------------------------------------------------
// Guardar un producto sin pisar ventas.
//
// El panel escribe el stock como número absoluto (lo que se ve en pantalla).
// Si entra una venta mientras el formulario está abierto, crear_pedido ya
// descontó unidades y guardar el número viejo las "devolvería" (sobreventa).
// Por eso, cuando el stock cambia, el update solo se aplica si en la base sigue
// el valor que se leyó al abrir; si no, se avisa con el stock real.
// ---------------------------------------------------------------------------

export type ResultadoGuardarProducto =
  | { ok: true }
  | { ok: false; conflicto: true; stockActual: number }
  | { ok: false; conflicto: false; error: string }

// Mensaje para cuando el stock cambió mientras se editaba.
export function mensajeConflictoStock(leido: number, actual: number): string {
  const diferencia = leido - actual
  const motivo =
    diferencia > 0
      ? `se vendi${diferencia === 1 ? 'ó 1 unidad' : `eron ${diferencia} unidades`}`
      : 'alguien más lo modificó'
  return (
    `Mientras editabas, ${motivo}: el stock ahora es ${actual}. ` +
    'No se guardó nada. Revisá el número y guardá de nuevo.'
  )
}

// Actualiza el producto `id` con `cambios`. Si `cambios` incluye `stock`, la
// escritura es condicional a que la base todavía tenga `stockLeido`.
export async function guardarProductoSinPisarStock(
  id: string,
  cambios: Record<string, unknown>,
  stockLeido: number,
): Promise<ResultadoGuardarProducto> {
  let consulta = supabase.from('productos').update(cambios).eq('id', id)
  if ('stock' in cambios) consulta = consulta.eq('stock', stockLeido)
  const { data, error } = await consulta.select('id')
  if (error) return { ok: false, conflicto: false, error: error.message }
  if (data && data.length > 0) return { ok: true }

  // 0 filas: o cambió el stock, o no hay permiso (RLS). Lo distinguimos
  // leyendo el valor real.
  const { data: fila, error: errLeer } = await supabase
    .from('productos')
    .select('stock')
    .eq('id', id)
    .maybeSingle()
  if (errLeer || !fila) {
    return { ok: false, conflicto: false, error: errLeer?.message ?? 'El producto ya no existe.' }
  }
  if ('stock' in cambios && fila.stock !== stockLeido) {
    return { ok: false, conflicto: true, stockActual: fila.stock }
  }
  return { ok: false, conflicto: false, error: 'No tenés permiso para modificar este producto.' }
}
