import { supabase } from './supabaseClient'

// Favoritos de la clienta (migración *_favoritos_direcciones). La lista vive
// en FavoritosContext; acá solo las llamadas a la base.

/** Ids de los productos favoritos de la cuenta logueada. null si falla o falta la migración. */
export async function cargarFavoritos(): Promise<string[] | null> {
  try {
    const { data, error } = await supabase
      .from('favoritos')
      .select('producto_id')
      .order('created_at', { ascending: false })
    if (error) return null
    return (data ?? []).map((f) => f.producto_id as string)
  } catch {
    return null
  }
}

export async function agregarFavorito(productoId: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('favoritos').insert({ producto_id: productoId })
    // 23505 = ya estaba: da lo mismo.
    return !error || error.code === '23505'
  } catch {
    return false
  }
}

export async function quitarFavorito(productoId: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('favoritos').delete().eq('producto_id', productoId)
    return !error
  } catch {
    return false
  }
}
