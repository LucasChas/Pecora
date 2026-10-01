import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import type { EstadoPedido, Pedido } from '../types'

// Cuántos pedidos trae cada "página". El panel arranca con estos y suma más con
// el botón "Ver más" (paginar es más cómodo en el celular que un scroll infinito).
const POR_PAGINA = 20

// 'eliminados' no es un estado del pedido: es la papelera (ver migración 0009).
// 'sin-pagar' = pedidos activos (no cancelados) sin marca de pago.
export type FiltroEstado = EstadoPedido | 'todos' | 'eliminados' | 'sin-pagar'

// Cantidad de pedidos por filtro, para los chips y el badge de la pestaña. Se
// cuenta en la base (no sobre la página cargada), así los números son los
// reales aunque estés viendo solo los primeros 20.
export type ConteosPedidos = Record<FiltroEstado, number>

const ESTADOS: EstadoPedido[] = ['nuevo', 'confirmado', 'enviado', 'entregado', 'cancelado']
const FILTROS_CONTADOS: FiltroEstado[] = ['todos', ...ESTADOS, 'eliminados', 'sin-pagar']

const CONTEOS_VACIOS = Object.fromEntries(FILTROS_CONTADOS.map((f) => [f, 0])) as ConteosPedidos

// Filtro de la lista. La papelera es una vista aparte: el resto la excluye.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function aplicarFiltro<Q extends { is: any; not: any; eq: any; neq: any }>(query: Q, filtro: FiltroEstado): Q {
  if (filtro === 'eliminados') return query.not('eliminado_at', 'is', null)
  const activos = query.is('eliminado_at', null)
  if (filtro === 'todos') return activos
  if (filtro === 'sin-pagar') return activos.neq('estado', 'cancelado').is('pagado_at', null)
  return activos.eq('estado', filtro)
}

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

    query = aplicarFiltro(query, estado)

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

  // Conteos por filtro: pedimos solo el total (head: true no trae filas). Si
  // uno falla (ej. falta una migración) cuenta 0 y el resto sigue.
  const fetchConteos = useCallback(async () => {
    const respuestas = await Promise.all(
      FILTROS_CONTADOS.map((f) =>
        aplicarFiltro(supabase.from('pedidos').select('*', { count: 'exact', head: true }), f),
      ),
    )
    setConteos(
      Object.fromEntries(FILTROS_CONTADOS.map((f, i) => [f, respuestas[i].count ?? 0])) as ConteosPedidos,
    )
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
