import { useEffect, useMemo, useRef, useState } from 'react'
import type { Producto } from '../types'
import {
  crearMiniaturasAutomaticas,
  firmaDeRutas,
  rutasOriginales,
  type MiniaturasAutomaticas,
} from '../lib/thumbnails'

// Miniaturas automáticas del panel: con `activo` (admin logueada y el panel a
// la vista), cuando el panel queda tranquilo genera en segundo plano las
// miniaturas que falten (fotos viejas, subidas que fallaron). Sin botón ni
// confirmación: un resumen en la consola y nada en pantalla mientras funcione.
// `necesitaAtencion` se prende solo si viene fallando varias pasadas seguidas
// (para un aviso discreto) y se apaga con la primera pasada sin problemas.
// Cuándo corre, cuándo se pausa y cada cuánto: ver crearMiniaturasAutomaticas.
export function useMiniaturasAutomaticas(
  productos: Pick<Producto, 'imagenes' | 'imagen_url'>[],
  activo: boolean,
): { necesitaAtencion: boolean } {
  const rutas = useMemo(() => rutasOriginales(productos), [productos])
  const firma = useMemo(() => firmaDeRutas(rutas), [rutas])
  const autoRef = useRef<MiniaturasAutomaticas | null>(null)
  const [necesitaAtencion, setNecesitaAtencion] = useState(false)

  useEffect(() => {
    if (!activo) return
    const auto = crearMiniaturasAutomaticas({}, { alCambiarAtencion: setNecesitaAtencion })
    autoRef.current = auto
    // Lo que dejaron anotado visitas anteriores.
    setNecesitaAtencion(auto.necesitaAtencion())
    return () => {
      // Deja de arrancar fotos nuevas; las que están subiendo terminan solas
      // (o se cortan al vencer su tope).
      auto.destruir()
      if (autoRef.current === auto) autoRef.current = null
    }
  }, [activo])

  useEffect(() => {
    autoRef.current?.actualizar(rutas, firma)
    // `rutas` cambia de referencia con cada recarga de productos aunque las
    // fotos sean las mismas (ej. editar un precio): la clave real es la firma.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, firma])

  return { necesitaAtencion: activo && necesitaAtencion }
}
