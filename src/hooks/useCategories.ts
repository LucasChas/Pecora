import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { Categoria } from '../types'

// Trae las categorías (ordenadas alfabéticamente) y se mantiene actualizado
// en tiempo real. Se usa tanto en el catálogo (chips de filtro) como en el
// admin (selector y gestión de categorías).
export function useCategories() {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCategorias = useCallback(async () => {
    const { data, error } = await supabase
      .from('categorias')
      .select('*')
      .order('nombre', { ascending: true })

    if (error) setError(error.message)
    else {
      setCategorias(data ?? [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchCategorias()

    const canal = supabase
      .channel('catalogo-categorias')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'categorias' },
        fetchCategorias,
      )
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
  }, [fetchCategorias])

  return { categorias, loading, error, refetch: fetchCategorias }
}
