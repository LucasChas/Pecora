// ============================================================================
// Caché compartida entre instancias con escritura monótona.
//
// Varias vistas montan useProducts a la vez o una tras otra (muestrario,
// relacionados, panel) y todas escriben la misma caché de módulo. Cada pedido
// recibe un número global creciente al lanzarse; una respuesta solo se guarda
// si es de un pedido más nuevo que el que ya está guardado. Así una respuesta
// lenta (de una instancia que ya se desmontó, o superada por otra) nunca pisa
// datos más nuevos.
// ============================================================================

export interface CacheMonotona<T> {
  // Datos guardados (null si todavía no llegó ninguna respuesta buena).
  leer(): T | null
  // Reserva el número del próximo pedido. Se llama al lanzarlo.
  nuevoPedido(): number
  // Ofrece la respuesta del pedido `pedido`: se guarda solo si es más nueva
  // que la guardada. Devuelve los datos vigentes después de decidir (los
  // ofrecidos si se aceptaron; si no, los guardados, que son más nuevos).
  ofrecer(pedido: number, datos: T): T
}

export function crearCacheMonotona<T>(): CacheMonotona<T> {
  let guardados: T | null = null
  // Número del pedido cuyos datos están guardados (0 = ninguno todavía).
  let version = 0
  let emitidos = 0

  return {
    leer: () => guardados,
    nuevoPedido: () => ++emitidos,
    ofrecer(pedido, datos) {
      if (guardados === null || pedido > version) {
        version = pedido
        guardados = datos
      }
      return guardados
    },
  }
}

// ============================================================================
// Refrescos agrupados (debounce con espera máxima).
//
// Cada fila que cambia dispara un aviso de Realtime: una importación de 20
// productos o un pedido con N ítems (que descuenta stock de N filas) generaba
// N re-fetch de la lista completa. Los avisos se agrupan: la acción corre una
// sola vez `espera` ms después del último aviso (trailing), pero nunca más de
// `esperaMaxima` ms después del primero, para que una ráfaga continua no
// posponga el refresco para siempre.
// ============================================================================

export interface OpcionesAgrupado {
  espera?: number
  esperaMaxima?: number
}

export interface DisparoAgrupado {
  // Registra un aviso: (re)programa la acción.
  pedir(): void
  // Descarta lo pendiente (ej. al desmontar).
  cancelar(): void
  // ¿Hay una ejecución programada?
  pendiente(): boolean
}

export const ESPERA_REFRESCO_MS = 800
export const ESPERA_MAXIMA_REFRESCO_MS = 3000

export function crearDisparoAgrupado(
  accion: () => void,
  { espera = ESPERA_REFRESCO_MS, esperaMaxima = ESPERA_MAXIMA_REFRESCO_MS }: OpcionesAgrupado = {},
): DisparoAgrupado {
  let timer: ReturnType<typeof setTimeout> | null = null
  // Momento del primer aviso de la ráfaga en curso (null = no hay ráfaga).
  let inicioRafaga: number | null = null

  const cancelar = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    inicioRafaga = null
  }

  const ejecutar = () => {
    cancelar()
    accion()
  }

  return {
    pedir() {
      const ahora = Date.now()
      if (inicioRafaga === null) inicioRafaga = ahora
      if (timer !== null) clearTimeout(timer)
      const restanteMaximo = inicioRafaga + Math.max(esperaMaxima, 0) - ahora
      timer = setTimeout(ejecutar, Math.max(0, Math.min(espera, restanteMaximo)))
    },
    cancelar,
    pendiente: () => timer !== null,
  }
}
