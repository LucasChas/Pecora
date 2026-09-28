// ============================================================================
// Tareas asíncronas con tope de tiempo y concurrencia limitada.
// Genérico (sin React ni DOM): solo usa AbortController y setTimeout, que
// existen también fuera del navegador. Lo usan la lista de precios exportable
// (fotos de las cards) y las miniaturas automáticas del panel.
// ============================================================================

// Resultado de una tarea: su valor, o por qué falló (error, tope o cancelación).
export type Resultado<T> = { ok: true; valor: T } | { ok: false; motivo: string }

// Corre una tarea con un tope de tiempo (ms). La tarea recibe una señal que se
// aborta al vencer el tope o si se aborta `cancelar`. Aunque la tarea ignore la
// señal y nunca termine, pasado el tope se da por fallida igual. Nunca rechaza.
export function conTiempoMax<T>(
  tarea: (signal: AbortSignal) => Promise<T>,
  tiempoMax: number,
  cancelar?: AbortSignal,
): Promise<Resultado<T>> {
  return new Promise((resolve) => {
    const control = new AbortController()
    const abortar = () => control.abort()
    let reloj: ReturnType<typeof setTimeout> | undefined
    const terminar = (resultado: Resultado<T>) => {
      clearTimeout(reloj)
      cancelar?.removeEventListener('abort', abortar)
      resolve(resultado)
    }

    if (cancelar?.aborted) {
      terminar({ ok: false, motivo: 'cancelada' })
      return
    }
    cancelar?.addEventListener('abort', abortar, { once: true })
    reloj = setTimeout(() => {
      control.abort()
      terminar({ ok: false, motivo: `sin respuesta en ${tiempoMax / 1000} s` })
    }, tiempoMax)

    // new Promise(...) también atrapa un error síncrono de la tarea.
    new Promise<T>((r) => r(tarea(control.signal))).then(
      (valor) => terminar({ ok: true, valor }),
      (error: unknown) =>
        terminar({ ok: false, motivo: cancelar?.aborted ? 'cancelada' : motivoDe(error) }),
    )
  })
}

// Corre `tarea` para cada elemento con a lo sumo `concurrencia` a la vez y un
// tope de tiempo por tarea (ver conTiempoMax). Nunca rechaza: devuelve un
// Resultado por elemento, en el mismo orden. `alAvanzar` se llama cada vez que
// termina una (bien o mal).
//
// Dos formas de frenar, las dos dejan como 'cancelada' lo que no llegó a correr:
// - `cancelar`: no arranca más tareas y aborta la señal de las que están corriendo.
// - `detener`: solo deja de arrancar tareas nuevas; las que ya corren siguen
//   hasta terminar o vencer su tope (ej. la pestaña pasó a segundo plano).
export async function correrTareas<E, T>(
  elementos: E[],
  tarea: (elemento: E, signal: AbortSignal) => Promise<T>,
  opciones: {
    concurrencia: number
    tiempoMax: number
    cancelar?: AbortSignal
    detener?: AbortSignal
    alAvanzar?: (hechas: number, total: number) => void
  },
): Promise<Resultado<T>[]> {
  const { concurrencia, tiempoMax, cancelar, detener, alAvanzar } = opciones
  const resultados: Resultado<T>[] = elementos.map(() => ({ ok: false, motivo: 'cancelada' }))
  let siguiente = 0
  let hechas = 0

  // Cada carril toma el próximo elemento libre hasta que no queden.
  const carril = async () => {
    while (siguiente < elementos.length && !cancelar?.aborted && !detener?.aborted) {
      const i = siguiente++
      const correr = (signal: AbortSignal) => tarea(elementos[i], signal)
      resultados[i] = await conTiempoMax(correr, tiempoMax, cancelar)
      hechas++
      alAvanzar?.(hechas, elementos.length)
    }
  }
  const carriles = Math.max(1, Math.min(concurrencia, elementos.length))
  await Promise.all(Array.from({ length: carriles }, carril))
  return resultados
}

function motivoDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
