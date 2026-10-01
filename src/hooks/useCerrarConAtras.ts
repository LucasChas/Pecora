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
// `pedirCierre` devuelve (o resuelve) false si la hoja no se cerró.

const CLAVE = 'pecoraHoja'
let ultimoNivel = 0

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
    const nivel = ++ultimoNivel
    window.history.pushState({ ...(window.history.state ?? {}), [CLAVE]: nivel }, '')
    let activa = true

    const onPop = async () => {
      if (!activa || nivelActual() >= nivel) return // "Atrás" no era para esta hoja
      activa = false
      const cerro = await pedirCierreRef.current()
      if (cerro === false) {
        // Se arrepintió: volvemos a dejar la entrada para el próximo "Atrás".
        window.history.pushState({ ...(window.history.state ?? {}), [CLAVE]: nivel }, '')
        activa = true
      }
    }
    window.addEventListener('popstate', onPop)

    return () => {
      window.removeEventListener('popstate', onPop)
      // Se cerró por la interfaz: sacamos nuestra entrada si sigue arriba.
      if (activa && nivelActual() === nivel) window.history.back()
    }
  }, [abierta])
}
