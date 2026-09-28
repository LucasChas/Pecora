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
