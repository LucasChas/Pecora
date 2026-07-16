import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { Pedido } from '../types'

// Trae los pedidos (más nuevos primero) y se mantiene actualizado en tiempo real:
// cuando entra un pedido nuevo o cambia un estado, la lista se refresca sola.
// Solo la administradora autenticada puede leerlos (RLS, ver migración 0003).
export function useOrders() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPedidos = useCallback(async () => {
    const { data, error } = await supabase
      .from('pedidos')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) setError(error.message)
    else {
      setPedidos((data ?? []) as Pedido[])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchPedidos()

    const canal = supabase
      .channel('admin-pedidos')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pedidos' },
        fetchPedidos,
      )
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
  }, [fetchPedidos])

  return { pedidos, loading, error, refetch: fetchPedidos }
}
