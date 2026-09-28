import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crearCacheMonotona, ESPERA_MAXIMA_REFRESCO_MS, ESPERA_REFRESCO_MS } from './productsCache'
import {
  crearSincronizacionProductos,
  MENSAJE_ERROR_PRODUCTOS,
  type AvisosCanal,
  type EventoSincronizacion,
  type ResultadoCarga,
} from './sincronizacionProductos'

type Lista = string[]

// Pedido controlable: se resuelve cuando el test quiere (orden arbitrario).
interface PedidoFalso {
  resolver(r: ResultadoCarga<Lista>): Promise<void>
  rechazar(e: unknown): Promise<void>
}

function armar(cache = crearCacheMonotona<Lista>()) {
  const pedidos: PedidoFalso[] = []
  const eventos: EventoSincronizacion<Lista>[] = []
  const canales: { avisos: AvisosCanal; cerrar: ReturnType<typeof vi.fn> }[] = []

  const traer = vi.fn(
    () =>
      new Promise<ResultadoCarga<Lista>>((resolve, reject) => {
        pedidos.push({
          resolver: async (r) => {
            resolve(r)
            await vi.advanceTimersByTimeAsync(0)
          },
          rechazar: async (e) => {
            reject(e)
            await vi.advanceTimersByTimeAsync(0)
          },
        })
      }),
  )
  const suscribir = vi.fn((avisos: AvisosCanal) => {
    const cerrar = vi.fn()
    canales.push({ avisos, cerrar })
    return cerrar
  })
  const sync = crearSincronizacionProductos<Lista>({
    cache,
    traer,
    suscribir,
    publicar: (e) => eventos.push(e),
  })
  const canal = () => canales[canales.length - 1].avisos
  return { sync, cache, traer, suscribir, pedidos, eventos, canales, canal }
}

const ultimo = (eventos: EventoSincronizacion<Lista>[]) => eventos[eventos.length - 1]

describe('crearSincronizacionProductos', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('al iniciar pide la lista enseguida (con "cargando" si no hay caché) y abre el canal', async () => {
    const t = armar()
    t.sync.iniciar()
    expect(t.traer).toHaveBeenCalledTimes(1)
    expect(t.suscribir).toHaveBeenCalledTimes(1)
    expect(t.eventos).toEqual([{ tipo: 'cargando' }])

    await t.pedidos[0].resolver({ datos: ['a'] })
    expect(ultimo(t.eventos)).toEqual({ tipo: 'datos', datos: ['a'] })
    expect(t.cache.leer()).toEqual(['a'])
  })

  it('con caché no muestra "cargando": refresca en segundo plano', async () => {
    const cache = crearCacheMonotona<Lista>()
    cache.ofrecer(cache.nuevoPedido(), ['viejo'])
    const t = armar(cache)
    t.sync.iniciar()
    expect(t.eventos).toEqual([])
    await t.pedidos[0].resolver({ datos: ['nuevo'] })
    expect(t.eventos).toEqual([{ tipo: 'datos', datos: ['nuevo'] }])
  })

  it('una ráfaga de avisos de Realtime produce un solo refresco, 800 ms después del último', async () => {
    const t = armar()
    t.sync.iniciar()
    await t.pedidos[0].resolver({ datos: ['a'] })
    t.canal().conectado()

    for (let i = 0; i < 20; i++) {
      t.canal().cambio()
      vi.advanceTimersByTime(50)
    }
    // El último aviso fue hace 50 ms: todavía no.
    vi.advanceTimersByTime(ESPERA_REFRESCO_MS - 51)
    expect(t.traer).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(t.traer).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(10_000)
    expect(t.traer).toHaveBeenCalledTimes(2)
  })

  it('una ráfaga continua no posterga el refresco más de 3 s desde el primer aviso', () => {
    const t = armar()
    t.sync.iniciar()
    t.canal().cambio()
    // Un aviso cada 500 ms (< 800 ms): el debounce solo nunca dispararía.
    for (let ms = 500; ms < ESPERA_MAXIMA_REFRESCO_MS; ms += 500) {
      vi.advanceTimersByTime(500)
      t.canal().cambio()
    }
    expect(t.traer).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(500)
    expect(t.traer).toHaveBeenCalledTimes(2)
  })

  it('tras un corte del canal, al volver a suscribirse pide la lista una vez', () => {
    const t = armar()
    t.sync.iniciar()

    // La primera suscripción no es una reconexión.
    t.canal().conectado()
    vi.advanceTimersByTime(ESPERA_MAXIMA_REFRESCO_MS)
    expect(t.traer).toHaveBeenCalledTimes(1)

    t.canal().cortado()
    t.canal().cortado()
    vi.advanceTimersByTime(ESPERA_MAXIMA_REFRESCO_MS)
    expect(t.traer).toHaveBeenCalledTimes(1)

    t.canal().conectado()
    vi.advanceTimersByTime(ESPERA_REFRESCO_MS)
    expect(t.traer).toHaveBeenCalledTimes(2)

    // Otro SUBSCRIBED sin corte en el medio no vuelve a pedir.
    t.canal().conectado()
    vi.advanceTimersByTime(ESPERA_MAXIMA_REFRESCO_MS)
    expect(t.traer).toHaveBeenCalledTimes(2)
  })

  it('al detener a mitad de una ráfaga cancela el refresco pendiente y cierra el canal', () => {
    const t = armar()
    t.sync.iniciar()
    t.canal().cambio()
    t.canal().cambio()
    t.sync.detener()
    expect(t.canales[0].cerrar).toHaveBeenCalledTimes(1)

    // Avisos tardíos del canal que se está cerrando: se ignoran.
    t.canal().cambio()
    t.canal().cortado()
    t.canal().conectado()
    vi.advanceTimersByTime(10_000)
    expect(t.traer).toHaveBeenCalledTimes(1)
  })

  it('una respuesta que llega después de detener no publica, pero alimenta la caché si es más nueva', async () => {
    const t = armar()
    t.sync.iniciar()
    t.sync.detener()
    await t.pedidos[0].resolver({ datos: ['tarde'] })
    expect(t.eventos).toEqual([{ tipo: 'cargando' }])
    expect(t.cache.leer()).toEqual(['tarde'])
  })

  it('si dos respuestas llegan fuera de orden, solo se publica la del último pedido', async () => {
    const t = armar()
    t.sync.iniciar()
    const refresco = t.sync.refrescar() // "Reintentar" casi junto con la carga inicial
    await t.pedidos[1].resolver({ datos: ['nuevo'] })
    await refresco
    await t.pedidos[0].resolver({ datos: ['viejo'] })

    expect(t.eventos.filter((e) => e.tipo === 'datos')).toEqual([{ tipo: 'datos', datos: ['nuevo'] }])
    // Caché monótona: la respuesta vieja no la pisa.
    expect(t.cache.leer()).toEqual(['nuevo'])
  })

  it('una respuesta lenta no retrocede la caché que actualizó otra instancia, y publica lo vigente', async () => {
    const cache = crearCacheMonotona<Lista>()
    const a = armar(cache)
    const b = armar(cache)
    a.sync.iniciar() // pedido 1 (lento)
    b.sync.iniciar() // pedido 2
    await b.pedidos[0].resolver({ datos: ['de-b'] })
    await a.pedidos[0].resolver({ datos: ['de-a-viejo'] })

    expect(cache.leer()).toEqual(['de-b'])
    expect(ultimo(a.eventos)).toEqual({ tipo: 'datos', datos: ['de-b'] })
  })

  it('un error publica el mensaje y conserva la última lista buena en la caché', async () => {
    const t = armar()
    t.sync.iniciar()
    await t.pedidos[0].resolver({ datos: ['a'] })

    const r1 = t.sync.refrescar()
    await t.pedidos[1].resolver({ error: 'sin red' })
    await r1
    expect(ultimo(t.eventos)).toEqual({ tipo: 'error', mensaje: 'sin red' })
    expect(t.cache.leer()).toEqual(['a'])

    const r2 = t.sync.refrescar()
    await t.pedidos[2].rechazar(new Error('boom'))
    await r2
    expect(ultimo(t.eventos)).toEqual({ tipo: 'error', mensaje: 'boom' })

    const r3 = t.sync.refrescar()
    await t.pedidos[3].resolver({ error: '' })
    await r3
    expect(ultimo(t.eventos)).toEqual({ tipo: 'error', mensaje: MENSAJE_ERROR_PRODUCTOS })
  })

  it('se puede volver a iniciar tras detener (StrictMode): solo cuenta el canal nuevo', async () => {
    const t = armar()
    t.sync.iniciar()
    t.sync.detener()
    t.sync.iniciar()
    expect(t.traer).toHaveBeenCalledTimes(2)
    expect(t.canales).toHaveLength(2)
    expect(t.canales[1].cerrar).not.toHaveBeenCalled()

    // La respuesta del primer montaje ya no es la última: no se publica.
    await t.pedidos[0].resolver({ datos: ['primero'] })
    expect(t.eventos.some((e) => e.tipo === 'datos')).toBe(false)
    await t.pedidos[1].resolver({ datos: ['segundo'] })
    expect(ultimo(t.eventos)).toEqual({ tipo: 'datos', datos: ['segundo'] })

    // El canal viejo ya no dispara refrescos; el nuevo sí.
    t.canales[0].avisos.cambio()
    vi.advanceTimersByTime(ESPERA_MAXIMA_REFRESCO_MS)
    expect(t.traer).toHaveBeenCalledTimes(2)
    t.canales[1].avisos.cambio()
    vi.advanceTimersByTime(ESPERA_REFRESCO_MS)
    expect(t.traer).toHaveBeenCalledTimes(3)
  })
})
