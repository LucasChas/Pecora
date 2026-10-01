import { useEffect, useRef } from 'react'

// Hace que el botón (o gesto) "Atrás" del celular cierre una hoja abierta en
// vez de salir del panel.
//
// Al abrir la hoja se agrega una entrada al historial (misma URL). "Atrás" la
// saca y acá se llama a `pedirCierre`, que puede preguntar "¿Descartar
// cambios?": si la respuesta es no, la entrada se vuelve a poner. Si la hoja
// se cierra por la interfaz (Cancelar, Guardar, tocar el fondo), se saca la
// entrada para que el siguiente "Atrás" haga lo de siempre.
//
// Con hojas una arriba de otra (categorías sobre producto), cada una tiene su
// nivel: "Atrás" cierra solo la de arriba.
//
// `pedirCierre` puede preguntar antes de cerrar; si no cierra, la hoja sigue
// abierta con su entrada en el historial.

const CLAVE = 'pecoraHoja'
let ultimoNivel = 0
// Cierre recién pedido por una hoja que se desmontó. Se hace en diferido: si
// la misma hoja se vuelve a montar enseguida (React en modo desarrollo monta,
// desmonta y vuelve a montar), reusa su entrada en vez de sacarla y que el
// "popstate" de ese back la cierre sola.
let cierrePendiente: { nivel: number; timer: number } | null = null

function nivelActual(): number {
  const estado = window.history.state as Record<string, unknown> | null
  return typeof estado?.[CLAVE] === 'number' ? (estado[CLAVE] as number) : 0
}

export function useCerrarConAtras(
  abierta: boolean,
  pedirCierre: () => boolean | void | Promise<boolean | void>,
) {
  const pedirCierreRef = useRef(pedirCierre)
  pedirCierreRef.current = pedirCierre

  useEffect(() => {
    if (!abierta) return
    let nivel: number
    if (cierrePendiente && nivelActual() === cierrePendiente.nivel) {
      window.clearTimeout(cierrePendiente.timer)
      nivel = cierrePendiente.nivel
      cierrePendiente = null
    } else {
      // Después de recargar, el contador vuelve a 0 pero la entrada del
      // historial conserva su nivel viejo: arrancamos por encima de ese.
      nivel = Math.max(ultimoNivel, nivelActual()) + 1
      ultimoNivel = nivel
      window.history.pushState({ ...(window.history.state ?? {}), [CLAVE]: nivel }, '')
    }
    let preguntando = false
    const ponerEntrada = () =>
      window.history.pushState({ ...(window.history.state ?? {}), [CLAVE]: nivel }, '')

    const onPop = async () => {
      if (nivelActual() >= nivel) return // "Atrás" no era para esta hoja
      // Volvemos a poner la entrada mientras se decide: si pregunta "¿Descartar
      // cambios?" y vuelve a tocar Atrás, no se sale del panel sin contestar.
      ponerEntrada()
      if (preguntando) return
      preguntando = true
      try {
        // Si cierra, la limpieza del efecto saca la entrada; si no, queda.
        await pedirCierreRef.current()
      } finally {
        preguntando = false
      }
    }
    window.addEventListener('popstate', onPop)

    return () => {
      window.removeEventListener('popstate', onPop)
      // Se cerró (por la interfaz o por Atrás): sacamos nuestra entrada si sigue arriba.
      if (nivelActual() !== nivel) return
      if (cierrePendiente) window.clearTimeout(cierrePendiente.timer)
      const timer = window.setTimeout(() => {
        cierrePendiente = null
        if (nivelActual() === nivel) window.history.back()
      }, 0)
      cierrePendiente = { nivel, timer }
    }
  }, [abierta])
}
