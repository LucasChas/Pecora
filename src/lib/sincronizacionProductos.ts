// ============================================================================
// Sincronización de la lista de productos (sin React ni Supabase).
//
// Orquesta lo que antes vivía dentro de useProducts, para poder testearlo con
// timers falsos (sincronizacionProductos.test.ts):
//   - carga inicial inmediata al iniciar y "Reintentar" (refrescar) inmediato;
//   - avisos de Realtime agrupados en un solo refresco (800 ms después del
//     último, como mucho 3 s después del primero; ver crearDisparoAgrupado);
//   - si el canal se corta y vuelve a quedar suscripto, un refresco para
//     ponerse al día con lo que se pudo perder en el medio;
//   - la caché compartida es monótona: una respuesta vieja no pisa una nueva;
//   - tras detener (desmontar), nada toca el estado: se cancela el refresco
//     pendiente, se ignoran los avisos tardíos del canal y las respuestas en
//     vuelo solo pueden alimentar la caché (si son más nuevas);
//   - si dos respuestas de la misma instancia llegan fuera de orden, solo se
//     publica la del último pedido lanzado.
// ============================================================================

import { crearDisparoAgrupado, type CacheMonotona, type OpcionesAgrupado } from './productsCache'

export type ResultadoCarga<T> = { datos: T } | { error: string }

export type EventoSincronizacion<T> =
  | { tipo: 'cargando' }
  | { tipo: 'datos'; datos: T }
  | { tipo: 'error'; mensaje: string }

// Avisos que el canal (Realtime) le da a la sincronización.
export interface AvisosCanal {
  // Cambió alguna fila de las tablas observadas.
  cambio(): void
  // El canal quedó suscripto (al inicio o tras reconectarse).
  conectado(): void
  // El canal se cortó (error, timeout o cierre).
  cortado(): void
}

export interface OpcionesSincronizacion<T> {
  cache: CacheMonotona<T>
  // Trae la lista. Puede rechazar: se trata como error.
  traer: () => Promise<ResultadoCarga<T>>
  // Abre el canal y devuelve cómo cerrarlo.
  suscribir: (avisos: AvisosCanal) => () => void
  // Recibe los cambios de estado visibles (solo mientras está iniciada).
  publicar: (evento: EventoSincronizacion<T>) => void
  agrupado?: OpcionesAgrupado
}

export interface SincronizacionProductos {
  // Carga inicial + suscripción. Se puede volver a llamar tras detener
  // (StrictMode monta, desmonta y vuelve a montar).
  iniciar(): void
  // Pedido inmediato (carga inicial, "Reintentar").
  refrescar(): Promise<void>
  // Cancela lo pendiente y cierra el canal.
  detener(): void
}

export const MENSAJE_ERROR_PRODUCTOS = 'No se pudieron cargar los productos.'

export function crearSincronizacionProductos<T>({
  cache,
  traer,
  suscribir,
  publicar,
  agrupado,
}: OpcionesSincronizacion<T>): SincronizacionProductos {
  let activa = false
  // Cada iniciar() abre una "generación": los avisos de un canal viejo (que
  // todavía se está cerrando) no disparan nada en la nueva.
  let generacion = 0
  // Número (global, de la caché) del último pedido lanzado por esta instancia.
  let ultimoPedido = 0
  let cerrarCanal: (() => void) | null = null

  async function refrescar(): Promise<void> {
    const pedido = cache.nuevoPedido()
    ultimoPedido = pedido
    // Sin datos todavía (arranque en frío o reintento tras un error): se
    // muestra "cargando". Con caché, se refresca en segundo plano.
    if (activa && cache.leer() === null) publicar({ tipo: 'cargando' })

    let resultado: ResultadoCarga<T>
    try {
      resultado = await traer()
    } catch (e) {
      resultado = { error: e instanceof Error ? e.message : String(e) }
    }

    // La caché decide sola si la respuesta es más nueva que la guardada; lo
    // vigente puede ser una lista aún más nueva que trajo otra instancia.
    const vigentes = 'datos' in resultado ? cache.ofrecer(pedido, resultado.datos) : null

    if (!activa || pedido !== ultimoPedido) return

    if (vigentes !== null) {
      publicar({ tipo: 'datos', datos: vigentes })
    } else {
      const mensaje = 'error' in resultado ? resultado.error : ''
      publicar({ tipo: 'error', mensaje: mensaje || MENSAJE_ERROR_PRODUCTOS })
    }
  }

  const disparo = crearDisparoAgrupado(() => {
    void refrescar()
  }, agrupado)

  function detener() {
    activa = false
    generacion++
    disparo.cancelar()
    const cerrar = cerrarCanal
    cerrarCanal = null
    cerrar?.()
  }

  function iniciar() {
    if (activa) detener()
    activa = true
    const miGeneracion = ++generacion
    const vigente = () => activa && generacion === miGeneracion
    let huboCorte = false

    void refrescar()

    cerrarCanal = suscribir({
      cambio() {
        if (vigente()) disparo.pedir()
      },
      conectado() {
        if (!vigente() || !huboCorte) return
        huboCorte = false
        disparo.pedir()
      },
      cortado() {
        if (vigente()) huboCorte = true
      },
    })
  }

  return { iniciar, refrescar, detener }
}
