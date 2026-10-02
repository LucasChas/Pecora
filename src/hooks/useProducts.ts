import { useEffect, useState } from 'react'
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import { crearCacheMonotona } from '../lib/productsCache'
import {
  crearSincronizacionProductos,
  type AvisosCanal,
  type ResultadoCarga,
} from '../lib/sincronizacionProductos'
import type { ProductoConCategoria } from '../types'
import { aplanarProducto, conTalles } from '../lib/productosConsulta'

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

// Pide la lista con el nombre de la categoría ya resuelto.
async function traerProductos(): Promise<ResultadoCarga<ProductoConCategoria[]>> {
  const { data, error } = await conTalles((select) =>
    supabase.from('productos').select(select).order('created_at', { ascending: false }),
  )

  if (error) return { error: error.message }

  // Aplanamos el join: categorias.nombre -> categoria_nombre, y los talles.
  return { datos: ((data as unknown[]) ?? []).map(aplanarProducto) }
}

// Suscripción Realtime a ambas tablas. Los estados del canal se traducen a
// avisos: SUBSCRIBED = conectado; cualquier otro (error, timeout o cierre) =
// cortado. Tras un corte, al volver a conectarse se refresca la lista (ver
// lib/sincronizacionProductos).
function suscribirCambios(avisos: AvisosCanal): () => void {
  const canal = supabase
    .channel(`catalogo-productos-${++secuenciaCanal}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, () => avisos.cambio())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categorias' }, () => avisos.cambio())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'producto_talles' }, () => avisos.cambio())
    .subscribe((estado, err) => {
      if (estado === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        avisos.conectado()
        return
      }
      if (estado === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
        console.warn('Realtime de productos con error; se reintenta solo.', err)
      }
      avisos.cortado()
    })
  return () => {
    supabase.removeChannel(canal)
  }
}

export function useProducts() {
  const [productos, setProductos] = useState<ProductoConCategoria[]>(() => cache.leer() ?? [])
  const [loading, setLoading] = useState(() => cache.leer() === null)
  const [error, setError] = useState<string | null>(null)

  // La orquestación (carga inicial, avisos de Realtime agrupados, reconexión,
  // respuestas fuera de orden y desmontaje) vive en lib/sincronizacionProductos,
  // con tests. Una instancia por montaje del hook; los setters son estables.
  const [sincronizacion] = useState(() =>
    crearSincronizacionProductos<ProductoConCategoria[]>({
      cache,
      traer: traerProductos,
      suscribir: suscribirCambios,
      publicar: (evento) => {
        if (evento.tipo === 'cargando') {
          setLoading(true)
          return
        }
        if (evento.tipo === 'datos') {
          setProductos(evento.datos)
          setError(null)
        } else {
          console.error('No se pudieron cargar los productos:', evento.mensaje)
          setError(evento.mensaje)
        }
        setLoading(false)
      },
    }),
  )

  useEffect(() => {
    sincronizacion.iniciar()
    return () => sincronizacion.detener()
  }, [sincronizacion])

  return { productos, loading, error, refetch: sincronizacion.refrescar }
}
