import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import type { EstadoPedido, Pedido } from '../types'

// Cuántos pedidos trae cada "página". El panel arranca con estos y suma más con
// el botón "Ver más" (paginar es más cómodo en el celular que un scroll infinito).
const POR_PAGINA = 20

// 'eliminados' no es un estado del pedido: es la papelera (ver migración 0009).
export type FiltroEstado = EstadoPedido | 'todos' | 'eliminados'

// Cantidad de pedidos por estado, para los chips del filtro y el badge de la
// pestaña. Se cuenta en la base (no sobre la página cargada), así los números
// son los reales aunque estés viendo solo los primeros 20.
export interface ConteosPedidos {
  todos: number
  nuevo: number
  confirmado: number
  entregado: number
  cancelado: number
  eliminados: number
}

const CONTEOS_VACIOS: ConteosPedidos = {
  todos: 0, nuevo: 0, confirmado: 0, entregado: 0, cancelado: 0, eliminados: 0,
}

const ESTADOS: EstadoPedido[] = ['nuevo', 'confirmado', 'entregado', 'cancelado']

// La búsqueda arma un filtro "or" de PostgREST, donde la coma separa condiciones.
// Sacamos los caracteres que romperían esa sintaxis.
function limpiarBusqueda(texto: string): string {
  return texto.trim().replace(/[,()*]/g, '')
}

// Trae los pedidos del panel: filtrados por estado, con búsqueda y paginados.
// Se mantiene al día en tiempo real (pedido nuevo o cambio de estado).
//
// Depende de la sesión a propósito: quien consulta define qué devuelve RLS. Sin
// esto, el fetch salía antes del login (como anónimo, 0 filas) y no se repetía al
// ingresar, así que la admin abría el panel y veía la lista vacía o incompleta.
export function useOrders(estado: FiltroEstado = 'todos', busqueda = '') {
  const { session } = useAuth()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [conteos, setConteos] = useState<ConteosPedidos>(CONTEOS_VACIOS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paginas, setPaginas] = useState(1)
  const [hayMas, setHayMas] = useState(false)

  const texto = limpiarBusqueda(busqueda)

  const fetchPedidos = useCallback(async () => {
    let query = supabase
      .from('pedidos')
      .select('*')
      .order('created_at', { ascending: false })
      .range(0, paginas * POR_PAGINA - 1)

    // La papelera es una vista aparte: el resto de los filtros la excluyen.
    if (estado === 'eliminados') {
      query = query.not('eliminado_at', 'is', null)
    } else {
      query = query.is('eliminado_at', null)
      if (estado !== 'todos') query = query.eq('estado', estado)
    }

    if (texto) {
      // Buscamos por nombre y teléfono; si además escribió un número, por nº de pedido.
      const condiciones = [`nombre.ilike.%${texto}%`, `telefono.ilike.%${texto}%`]
      const soloDigitos = texto.replace(/\D/g, '')
      if (soloDigitos) condiciones.push(`numero.eq.${soloDigitos}`)
      query = query.or(condiciones.join(','))
    }

    const { data, error } = await query
    if (error) setError(error.message)
    else {
      const filas = (data ?? []) as Pedido[]
      setPedidos(filas)
      // Si llenamos la página justo, asumimos que puede haber más.
      setHayMas(filas.length === paginas * POR_PAGINA)
      setError(null)
    }
    setLoading(false)
  }, [estado, texto, paginas])

  // Conteos por estado: pedimos solo el total (head: true no trae filas).
  const fetchConteos = useCallback(async () => {
    const activos = () =>
      supabase.from('pedidos').select('*', { count: 'exact', head: true }).is('eliminado_at', null)

    const consultas = [
      activos(),
      ...ESTADOS.map((e) => activos().eq('estado', e)),
      supabase
        .from('pedidos')
        .select('*', { count: 'exact', head: true })
        .not('eliminado_at', 'is', null),
    ]
    const [todos, ...resto] = await Promise.all(consultas)
    setConteos({
      todos: todos.count ?? 0,
      nuevo: resto[0].count ?? 0,
      confirmado: resto[1].count ?? 0,
      entregado: resto[2].count ?? 0,
      cancelado: resto[3].count ?? 0,
      eliminados: resto[4].count ?? 0,
    })
  }, [])

  const refetch = useCallback(() => {
    fetchPedidos()
    fetchConteos()
  }, [fetchPedidos, fetchConteos])

  // Al cambiar el filtro o la búsqueda volvemos a la primera página.
  useEffect(() => {
    setPaginas(1)
  }, [estado, texto])

  useEffect(() => {
    // Sin sesión no hay nada que traer (RLS devolvería 0 filas igual).
    if (!session) {
      setPedidos([])
      setConteos(CONTEOS_VACIOS)
      setLoading(false)
      return
    }

    setLoading(true)
    fetchPedidos()
    fetchConteos()

    const canal = supabase
      .channel('admin-pedidos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
        fetchPedidos()
        fetchConteos()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
  }, [session, fetchPedidos, fetchConteos])

  const verMas = useCallback(() => setPaginas((p) => p + 1), [])

  return { pedidos, conteos, loading, error, hayMas, verMas, refetch }
}
