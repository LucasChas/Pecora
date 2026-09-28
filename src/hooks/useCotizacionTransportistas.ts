import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  armarPedidoCotizacion,
  claveCotizacion,
  cotizarTransportistas,
  type CotizacionVigente,
  type OpcionEnvio,
} from '../lib/transportistas'

// Espera antes de cotizar mientras la clienta escribe el CP.
const DEBOUNCE_MS = 500

export type EstadoCotizacionTransportistas =
  // Todavía no hay destino completo (o es retiro).
  | 'inactivo'
  | 'cotizando'
  // Hay respuesta (puede no traer opciones: sin transportistas activos).
  | 'listo'
  // La función no está o falló: el checkout sigue con el envío por zona.
  | 'no_disponible'

interface Entrada {
  activo: boolean
  cp: string
  provincia: string
  items: readonly { id: string; cantidad: number }[]
}

export interface CotizacionTransportistasHook {
  estado: EstadoCotizacionTransportistas
  opciones: OpcionEnvio[]
  vigente: CotizacionVigente | null
  // Clave del destino + carrito actuales (null si no se puede cotizar).
  clave: string | null
  // Vuelve a cotizar ya (sin debounce). Devuelve las opciones nuevas, o null
  // si no se pudo (en ese caso el estado pasa a 'no_disponible').
  recotizar: () => Promise<OpcionEnvio[] | null>
}

// Cotiza con transportistas (Edge Function cotizar-envio) cuando hay CP y
// provincia, con debounce, y vuelve a cotizar si cambian el destino o el
// carrito. Descarta respuestas que llegan tarde.
//
// Si la función no está desplegada o no hay transportistas con credenciales,
// deja de intentar en esta visita: no tiene sentido repetir la llamada con
// cada tecla.
export function useCotizacionTransportistas({ activo, cp, provincia, items }: Entrada): CotizacionTransportistasHook {
  const firmaItems = items.map((i) => `${i.id}:${i.cantidad}`).join('|')
  const pedido = useMemo(
    () => (activo ? armarPedidoCotizacion(cp, provincia, items) : null),
    // items entra por su firma: el arreglo del carrito cambia de identidad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activo, cp, provincia, firmaItems],
  )
  const clave = pedido ? claveCotizacion(pedido) : null

  const [estado, setEstado] = useState<EstadoCotizacionTransportistas>('inactivo')
  const [opciones, setOpciones] = useState<OpcionEnvio[]>([])
  const [vigente, setVigente] = useState<CotizacionVigente | null>(null)

  const desactivado = useRef(false)
  // Número de pedido en curso: solo se aplica la respuesta del último.
  const turno = useRef(0)

  const pedir = useCallback(async (): Promise<OpcionEnvio[] | null> => {
    if (!pedido || desactivado.current) return null
    const mio = ++turno.current
    setEstado('cotizando')
    const r = await cotizarTransportistas(pedido)
    if (mio !== turno.current) return null
    if (!r.ok) {
      if (r.motivo === 'sin_funcion') desactivado.current = true
      setOpciones([])
      setVigente(null)
      setEstado('no_disponible')
      return null
    }
    const { cotizacion } = r
    if (cotizacion.transportistasActivos.length === 0 && cotizacion.opciones.length === 0) {
      desactivado.current = true
      setOpciones([])
      setVigente(null)
      setEstado('no_disponible')
      return null
    }
    setOpciones(cotizacion.opciones)
    setVigente({ clave: claveCotizacion(pedido), obtenidaEn: Date.now() })
    setEstado('listo')
    return cotizacion.opciones
  }, [pedido])

  useEffect(() => {
    // Cambió el destino o el carrito: una respuesta en vuelo ya no sirve.
    turno.current++
    if (!pedido || desactivado.current) {
      setOpciones([])
      setVigente(null)
      setEstado(desactivado.current && pedido ? 'no_disponible' : 'inactivo')
      return
    }
    setEstado('cotizando')
    const t = window.setTimeout(() => {
      void pedir()
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [pedido, pedir])

  return { estado, opciones, vigente, clave, recotizar: pedir }
}
