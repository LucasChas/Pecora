import { useCallback, useEffect, useRef, useState } from 'react'
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import { crearCacheMonotona } from '../lib/productsCache'
import type { ProductoConCategoria } from '../types'

// Trae los productos con el nombre de su categoría resuelto y se mantiene
// actualizado en tiempo real: cualquier alta/edición/baja de producto o
// categoría (hecha desde el admin) vuelve a pedir la lista y refresca la vista.
//
// Optar por "re-fetch ante cualquier cambio" (en vez de parchear el estado
// evento por evento) mantiene el código simple y garantiza consistencia,
// incluso cuando se renombra una categoría (que afecta al join).
//
// Caché a nivel de módulo con la última lista traída: al volver al muestrario
// (el componente se vuelve a montar) se muestra al instante la lista anterior
// — y el scroll se puede restaurar — mientras se refresca en segundo plano.
//
// Si un refresco falla, se conserva la última lista buena (en pantalla y en la
// caché) y solo se expone `error`: cada vista decide cómo avisarlo. Con
// `productos` vacío y `error`, en cambio, no hay nada que mostrar.
//
// La caché la comparten todas las instancias (muestrario, relacionados,
// panel), así que sus escrituras son monótonas: una respuesta lenta de una
// instancia (aunque ya se haya desmontado) no pisa una lista más nueva que
// trajo otra. Ver lib/productsCache.
const cache = crearCacheMonotona<ProductoConCategoria[]>()

// Cada instancia del hook abre su propio canal con un nombre único. Con un
// nombre fijo, supabase.channel() devuelve el canal de la instancia anterior
// si todavía se está cerrando (ej. al pasar del muestrario a la ficha, que
// también usa este hook) y la suscripción nueva queda muerta; además, al
// terminar de cerrarse, el cliente descarta todo canal con ese nombre.
let secuenciaCanal = 0

export function useProducts() {
  const [productos, setProductos] = useState<ProductoConCategoria[]>(() => cache.leer() ?? [])
  const [loading, setLoading] = useState(() => cache.leer() === null)
  const [error, setError] = useState<string | null>(null)
  // Número (global) del último pedido lanzado por esta instancia: si dos
  // respuestas llegan fuera de orden (ej. "Reintentar" y un aviso de Realtime
  // casi juntos), en pantalla solo cuenta la más nueva.
  const ultimoPedidoRef = useRef(0)
  // Tras desmontar, las respuestas pendientes ya no tocan el estado (solo
  // pueden alimentar la caché, y únicamente si son más nuevas).
  const montadoRef = useRef(false)

  const fetchProductos = useCallback(async () => {
    const pedido = cache.nuevoPedido()
    ultimoPedidoRef.current = pedido
    // Sin datos todavía (arranque en frío o reintento tras un error): se
    // muestra "cargando". Con caché, se refresca en segundo plano.
    if (montadoRef.current && cache.leer() === null) setLoading(true)

    let filas: ProductoConCategoria[] | null = null
    let mensajeError: string | null = null
    try {
      const { data, error } = await supabase
        .from('productos')
        .select('*, categorias(nombre)')
        .order('created_at', { ascending: false })

      if (error) {
        mensajeError = error.message
      } else {
        // Aplanamos el join: categorias.nombre -> categoria_nombre
        filas = (data ?? []).map((row) => {
          const { categorias, ...resto } = row as Record<string, unknown> & {
            categorias: { nombre: string } | null
          }
          return {
            ...(resto as unknown as ProductoConCategoria),
            categoria_nombre: categorias?.nombre ?? null,
          }
        })
      }
    } catch (e) {
      mensajeError = e instanceof Error ? e.message : String(e)
    }

    // La caché decide sola si la respuesta es más nueva que la guardada; lo
    // vigente puede ser una lista aún más nueva que trajo otra instancia.
    const vigentes = filas ? cache.ofrecer(pedido, filas) : null

    if (!montadoRef.current || pedido !== ultimoPedidoRef.current) return

    if (vigentes) {
      setProductos(vigentes)
      setError(null)
    } else {
      console.error('No se pudieron cargar los productos:', mensajeError)
      setError(mensajeError || 'No se pudieron cargar los productos.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    montadoRef.current = true
    fetchProductos()

    // Si el canal se corta (error, timeout o cierre) y después vuelve a quedar
    // suscripto, pudo haberse perdido algún cambio en el medio: se pide la
    // lista una vez para ponerse al día.
    let huboCorte = false

    // Suscripción Realtime a ambas tablas.
    const canal = supabase
      .channel(`catalogo-productos-${++secuenciaCanal}`)
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
      .subscribe((estado, err) => {
        if (estado === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
          if (huboCorte) {
            huboCorte = false
            fetchProductos()
          }
          return
        }
        huboCorte = true
        if (estado === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
          console.warn('Realtime de productos con error; se reintenta solo.', err)
        }
      })

    return () => {
      montadoRef.current = false
      supabase.removeChannel(canal)
    }
  }, [fetchProductos])

  return { productos, loading, error, refetch: fetchProductos }
}
