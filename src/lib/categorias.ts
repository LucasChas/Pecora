import { supabase } from './supabaseClient'

// Operaciones de categorías del panel. Devuelven un mensaje de error listo
// para mostrar, o null si salió bien.

type ErrorSupabase = { code?: string; message: string } | null

function mensaje(error: ErrorSupabase, nombre: string, accion: string): string | null {
  if (!error) return null
  if (error.code === '23505') return `Ya existe una categoría "${nombre}".`
  return `No se pudo ${accion}: ${error.message}`
}

export function limpiarNombre(nombre: string): string {
  return nombre.trim().replace(/\s+/g, ' ')
}

export async function crearCategoria(nombre: string): Promise<string | null> {
  const limpio = limpiarNombre(nombre)
  if (!limpio) return 'Escribí un nombre para la categoría.'
  const { error } = await supabase.from('categorias').insert({ nombre: limpio })
  return mensaje(error, limpio, 'agregar')
}

export async function renombrarCategoria(id: string, nombre: string): Promise<string | null> {
  const limpio = limpiarNombre(nombre)
  if (!limpio) return 'El nombre no puede quedar vacío.'
  const { error } = await supabase.from('categorias').update({ nombre: limpio }).eq('id', id)
  return mensaje(error, limpio, 'renombrar')
}

// Elimina una categoría. Si tiene productos hay que indicar a qué categoría
// pasarlos (`moverA`): primero se mueven y después se borra. La base rechaza
// borrar una categoría con productos (FK + trigger), así que si el movimiento
// falla, la categoría sigue intacta.
export async function eliminarCategoria(
  id: string,
  opciones: { cantidadProductos: number; moverA?: string | null },
): Promise<string | null> {
  const { cantidadProductos, moverA } = opciones
  if (cantidadProductos > 0) {
    if (!moverA) return 'Elegí a qué categoría pasar sus productos.'
    if (moverA === id) return 'Elegí una categoría distinta a la que vas a eliminar.'
    const { error } = await supabase.from('productos').update({ categoria_id: moverA }).eq('categoria_id', id)
    if (error) return `No se pudieron mover los productos: ${error.message}`
  }
  const { error } = await supabase.from('categorias').delete().eq('id', id)
  return error ? `No se pudo eliminar: ${error.message}` : null
}

// Cuántos productos tiene cada categoría (por id).
export function contarPorCategoria(productos: { categoria_id: string | null }[]): Map<string, number> {
  const cuenta = new Map<string, number>()
  for (const p of productos) {
    if (p.categoria_id) cuenta.set(p.categoria_id, (cuenta.get(p.categoria_id) ?? 0) + 1)
  }
  return cuenta
}
