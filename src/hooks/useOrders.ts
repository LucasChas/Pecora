import { useCallback, useEffect, useRef, useState } from 'react'
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

// Espera desde la última tecla antes de buscar: sin esto cada letra disparaba
// 7 consultas y la lista parpadeaba en "Cargando…".
const ESPERA_BUSQUEDA_MS = 300

// Nombre único por suscripción: con un nombre fijo, supabase.channel()
// devuelve el canal anterior si todavía se está cerrando y la suscripción
// nueva queda muerta (mismo problema que resuelve useProducts).
let secuenciaCanal = 0

// Trae los pedidos del panel: filtrados por estado, con búsqueda y paginados.
// Se mantiene al día en tiempo real (pedido nuevo o cambio de estado).
//
// Depende de la sesión a propósito: quien consulta define qué devuelve RLS. Sin
// esto, el fetch salía antes del login (como anónimo, 0 filas) y no se repetía al
// ingresar, así que la admin abría el panel y veía la lista vacía o incompleta.
//
// El canal de Realtime se abre una sola vez por sesión (no con cada filtro o
// búsqueda) y llama siempre a la versión más nueva del fetch. Las respuestas
// que llegan fuera de orden (una búsqueda lenta después de una más nueva) se
// descartan.
//
// `onPedidoNuevo` se llama cuando entra un pedido (INSERT), para avisar.
export function useOrders(
  estado: FiltroEstado = 'todos',
  busqueda = '',
  onPedidoNuevo?: (pedido: Pedido) => void,
) {
  const { session } = useAuth()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [conteos, setConteos] = useState<ConteosPedidos>(CONTEOS_VACIOS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paginas, setPaginas] = useState(1)
  const [hayMas, setHayMas] = useState(false)

  // Búsqueda "asentada": la que efectivamente se consulta.
  const [texto, setTexto] = useState(() => limpiarBusqueda(busqueda))
  useEffect(() => {
    const limpio = limpiarBusqueda(busqueda)
    if (limpio === texto) return
    const t = setTimeout(() => setTexto(limpio), ESPERA_BUSQUEDA_MS)
    return () => clearTimeout(t)
  }, [busqueda, texto])

  // Número de la última consulta de la lista: solo esa puede escribir el estado.
  const ultimaConsulta = useRef(0)

  const fetchPedidos = useCallback(async () => {
    const nro = ++ultimaConsulta.current
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
      // Buscamos por nombre, teléfono, email y localidad; si además escribió
      // un número, por nº de pedido.
      const condiciones = [
        `nombre.ilike.%${texto}%`,
        `telefono.ilike.%${texto}%`,
        `email.ilike.%${texto}%`,
        `localidad.ilike.%${texto}%`,
      ]
      const soloDigitos = texto.replace(/\D/g, '')
      if (soloDigitos && soloDigitos.length <= 12) condiciones.push(`numero.eq.${soloDigitos}`)
      query = query.or(condiciones.join(','))
    }

    const { data, error } = await query
    if (nro !== ultimaConsulta.current) return // llegó tarde: hay una más nueva
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

  // Últimas versiones, para el canal de Realtime (que no se reabre).
  const fetchPedidosRef = useRef(fetchPedidos)
  fetchPedidosRef.current = fetchPedidos
  const onPedidoNuevoRef = useRef(onPedidoNuevo)
  onPedidoNuevoRef.current = onPedidoNuevo

  // Al cambiar el filtro o la búsqueda volvemos a la primera página.
  useEffect(() => {
    setPaginas(1)
  }, [estado, texto])

  // Lista: se vuelve a pedir con cada filtro, búsqueda o "Ver más", sin vaciar
  // la que está en pantalla (no se pierde el scroll).
  useEffect(() => {
    if (!session) return
    fetchPedidos()
  }, [session, fetchPedidos])

  useEffect(() => {
    // Sin sesión no hay nada que traer (RLS devolvería 0 filas igual).
    if (!session) {
      setPedidos([])
      setConteos(CONTEOS_VACIOS)
      setLoading(false)
      return
    }

    fetchConteos()

    const canal = supabase
      .channel(`admin-pedidos-${++secuenciaCanal}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, (cambio) => {
        fetchPedidosRef.current()
        fetchConteos()
        if (cambio.eventType === 'INSERT') onPedidoNuevoRef.current?.(cambio.new as Pedido)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
  }, [session, fetchConteos])

  const verMas = useCallback(() => setPaginas((p) => p + 1), [])

  // Mientras la búsqueda escrita no se consultó todavía.
  const buscando = limpiarBusqueda(busqueda) !== texto

  return { pedidos, conteos, loading, buscando, error, hayMas, verMas, refetch }
}
