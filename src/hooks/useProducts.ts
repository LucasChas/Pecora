import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { ProductoConCategoria } from '../types'

// Trae los productos con el nombre de su categoría resuelto y se mantiene
// actualizado en tiempo real: cualquier alta/edición/baja de producto o
// categoría (hecha desde el admin) vuelve a pedir la lista y refresca la vista.
//
// Optar por "re-fetch ante cualquier cambio" (en vez de parchear el estado
// evento por evento) mantiene el código simple y garantiza consistencia,
// incluso cuando se renombra una categoría (que afecta al join).
export function useProducts() {
  const [productos, setProductos] = useState<ProductoConCategoria[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProductos = useCallback(async () => {
    const { data, error } = await supabase
      .from('productos')
      .select('*, categorias(nombre)')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
    } else {
      // Aplanamos el join: categorias.nombre -> categoria_nombre
      const filas = (data ?? []).map((row) => {
        const { categorias, ...resto } = row as Record<string, unknown> & {
          categorias: { nombre: string } | null
        }
        return {
          ...(resto as unknown as ProductoConCategoria),
          categoria_nombre: categorias?.nombre ?? null,
        }
      })
      setProductos(filas)
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchProductos()

    // Suscripción Realtime a ambas tablas.
    const canal = supabase
      .channel('catalogo-productos')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'productos' },
        fetchProductos,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'categorias' },
        fetchProductos,
      )
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
  }, [fetchProductos])

  return { productos, loading, error, refetch: fetchProductos }
}
