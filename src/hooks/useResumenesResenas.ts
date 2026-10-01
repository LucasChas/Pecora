import { useEffect, useState } from 'react'
import type { ResumenResenas } from '../types'
import { cargarResumenesResenas } from '../lib/resenas'

// Promedio de estrellas por producto para las cards. Una sola carga por
// visita, compartida por todas las cards (muestrario, "lo más vendido",
// relacionados). Si falla o la tabla no existe, las cards no muestran
// estrellas.
let cache: Map<string, ResumenResenas> | null = null
let pedido: Promise<Map<string, ResumenResenas>> | null = null

function cargar(): Promise<Map<string, ResumenResenas>> {
  if (!pedido) {
    pedido = cargarResumenesResenas().then((r) => {
      cache = r.ok ? r.valor : new Map()
      return cache
    })
  }
  return pedido
}

/** Después de guardar o borrar una reseña: la próxima lectura vuelve a pedir. */
export function invalidarResumenesResenas() {
  cache = null
  pedido = null
}

export function useResumenesResenas(): Map<string, ResumenResenas> | null {
  const [mapa, setMapa] = useState(cache)
  useEffect(() => {
    if (cache) {
      setMapa(cache)
      return
    }
    let vigente = true
    void cargar().then((m) => {
      if (vigente) setMapa(m)
    })
    return () => {
      vigente = false
    }
  }, [])
  return mapa
}
