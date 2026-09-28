import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// El cliente real exige variables de entorno y habla con la red: se reemplaza
// por un Storage simulado (vi.hoisted para que exista cuando corre vi.mock).
const list = vi.hoisted(() => vi.fn())
const from = vi.hoisted(() => vi.fn())
vi.mock('./supabaseClient', () => ({ supabase: { storage: { from } } }))

const BASE = 'https://proyecto.supabase.co'
const PUB = `${BASE}/storage/v1/object/public/productos/`
const MIN = 60_000

let mod: typeof import('./miniaturasDisponibles')

// El módulo (vía images.ts) lee VITE_SUPABASE_URL al cargarse.
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', BASE)
  vi.resetModules()
  mod = await import('./miniaturasDisponibles')
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

// Reloj manual: cada registro de prueba usa este `ahora`.
let reloj = 0
const ahora = () => reloj

beforeEach(() => {
  reloj = 1_000_000
  list.mockReset()
  from.mockReset()
  from.mockReturnValue({ list })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---- Dobles ---------------------------------------------------------------------

type Entrada = { name: string; id: string | null; metadata: Record<string, unknown> | null }
const archivo = (name: string): Entrada => ({ name, id: `id-${name}`, metadata: { size: 1 } })
const carpeta = (name: string): Entrada => ({ name, id: null, metadata: null })
const archivos = (desde: number, cantidad: number) =>
  Array.from({ length: cantidad }, (_, i) => archivo(`f${desde + i}.jpg`))
const ok = (data: Entrada[]) => ({ data, error: null })

function diferida<T>() {
  let resolver!: (valor: T) => void
  const promesa = new Promise<T>((r) => {
    resolver = r
  })
  return { promesa, resolver }
}

// sessionStorage de mentira (Map) con los métodos espiables.
function almacenFalso(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial))
  return {
    datos,
    getItem: vi.fn((clave: string) => datos.get(clave) ?? null),
    setItem: vi.fn((clave: string, valor: string) => {
      datos.set(clave, valor)
    }),
  }
}

function crear(opciones: Parameters<typeof mod.crearRegistroMiniaturas>[0] = {}) {
  return mod.crearRegistroMiniaturas({ ahora, almacen: () => null, ...opciones })
}

// ---- Listado ---------------------------------------------------------------------

describe('listado de thumbs/', () => {
  it('pagina de a 1000 y arma las rutas completas', async () => {
    list.mockResolvedValueOnce(ok(archivos(0, 1000))).mockResolvedValueOnce(ok(archivos(1000, 3)))
    const rutas = await crear().cargar()

    expect(from).toHaveBeenCalledWith('productos')
    expect(list).toHaveBeenNthCalledWith(1, 'thumbs', {
      limit: 1000,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' },
    })
    expect(list).toHaveBeenNthCalledWith(2, 'thumbs', expect.objectContaining({ offset: 1000 }))
    expect(list).toHaveBeenCalledTimes(2)
    expect(rutas?.size).toBe(1003)
    expect(rutas?.has('thumbs/f0.jpg')).toBe(true)
    expect(rutas?.has('thumbs/f1002.jpg')).toBe(true)
  })

  it('con justo 1000 pide una página más y corta con la vacía', async () => {
    list.mockResolvedValueOnce(ok(archivos(0, 1000))).mockResolvedValueOnce(ok([]))
    const rutas = await crear().cargar()
    expect(list).toHaveBeenCalledTimes(2)
    expect(rutas?.size).toBe(1000)
  })

  it('recorre subcarpetas (entradas sin id ni metadata)', async () => {
    list.mockImplementation(async (ruta: string) =>
      ruta === 'thumbs' ? ok([archivo('a.jpg'), carpeta('viejas')]) : ok([archivo('b.jpg')]),
    )
    const rutas = await crear().cargar()
    expect(list).toHaveBeenCalledWith('thumbs/viejas', expect.objectContaining({ offset: 0 }))
    expect([...(rutas ?? [])].sort()).toEqual(['thumbs/a.jpg', 'thumbs/viejas/b.jpg'])
  })

  it('carpeta vacía (hoy, sin miniaturas): conjunto vacío, no null', async () => {
    list.mockResolvedValueOnce(ok([]))
    const registro = crear()
    await expect(registro.cargar()).resolves.toEqual(new Set())
    expect(registro.disponibles()).toEqual(new Set())
  })
})

// ---- Un solo pedido, TTL ----------------------------------------------------------

describe('pedidos compartidos y vigencia', () => {
  it('pedidos simultáneos comparten un solo listado', async () => {
    const d = diferida<ReturnType<typeof ok>>()
    list.mockReturnValueOnce(d.promesa)
    const registro = crear()
    const pedidos = [registro.cargar(), registro.cargar(), registro.cargar(true)]
    d.resolver(ok([archivo('a.jpg')]))
    const [a, b, c] = await Promise.all(pedidos)
    expect(list).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(a?.has('thumbs/a.jpg')).toBe(true)
  })

  it('dentro del TTL no vuelve a listar; pasado, sí (y mientras tanto sigue lo conocido)', async () => {
    list.mockResolvedValueOnce(ok([archivo('a.jpg')]))
    const registro = crear()
    const primero = await registro.cargar()

    reloj += 9 * MIN
    await expect(registro.cargar()).resolves.toBe(primero)
    expect(list).toHaveBeenCalledTimes(1)

    reloj += 1 * MIN
    const d = diferida<ReturnType<typeof ok>>()
    list.mockReturnValueOnce(d.promesa)
    const refresco = registro.cargar()
    expect(list).toHaveBeenCalledTimes(2)
    expect(registro.disponibles()).toBe(primero) // lo viejo sigue sirviendo
    d.resolver(ok([archivo('a.jpg'), archivo('b.jpg')]))
    const segundo = await refresco
    expect(segundo?.has('thumbs/b.jpg')).toBe(true)
    expect(registro.disponibles()).toBe(segundo)
  })

  it('forzar lista aunque siga vigente', async () => {
    list.mockResolvedValue(ok([archivo('a.jpg')]))
    const registro = crear()
    await registro.cargar()
    await registro.cargar(true)
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('un listado igual al anterior no cambia la referencia ni avisa', async () => {
    list.mockResolvedValue(ok([archivo('a.jpg')]))
    const registro = crear()
    const oyente = vi.fn()
    registro.suscribir(oyente)
    const primero = await registro.cargar()
    expect(oyente).toHaveBeenCalledTimes(1)
    await expect(registro.cargar(true)).resolves.toBe(primero)
    expect(oyente).toHaveBeenCalledTimes(1)
  })
})

// ---- Fallas: se degrada a originales -------------------------------------------------

describe('si Storage falla', () => {
  it('error de Storage: devuelve null, avisa y espera un minuto antes de reintentar', async () => {
    list.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    const registro = crear()
    await expect(registro.cargar()).resolves.toBeNull()
    expect(registro.disponibles()).toBeNull()
    expect(console.warn).toHaveBeenCalledTimes(1)

    await registro.cargar()
    expect(list).toHaveBeenCalledTimes(1) // sin ráfaga de pedidos

    reloj += mod.ESPERA_TRAS_FALLA_MS
    await registro.cargar()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('red caída (list rechaza): mismo resultado, sin romper', async () => {
    list.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(crear().cargar()).resolves.toBeNull()
  })

  it('falla después de un listado bueno: sigue con lo último conocido', async () => {
    list.mockResolvedValueOnce(ok([archivo('a.jpg')]))
    const registro = crear()
    const conocido = await registro.cargar()
    list.mockResolvedValueOnce({ data: null, error: { message: '503' } })
    await expect(registro.cargar(true)).resolves.toBe(conocido)
    expect(registro.disponibles()).toBe(conocido)
  })
})

// ---- sessionStorage -------------------------------------------------------------------

describe('sessionStorage', () => {
  it('guarda el listado y otra carga de la página lo usa sin pedir (dentro del TTL)', async () => {
    const almacen = almacenFalso()
    list.mockResolvedValueOnce(ok([archivo('a.jpg')]))
    await crear({ almacen: () => almacen }).cargar()
    expect(almacen.datos.has(mod.CLAVE_SESION)).toBe(true)

    reloj += 5 * MIN
    const otra = crear({ almacen: () => almacen })
    expect(otra.disponibles()?.has('thumbs/a.jpg')).toBe(true) // ya en el primer render
    await otra.cargar()
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('guardado vencido: se usa mientras se vuelve a listar', async () => {
    const almacen = almacenFalso({
      [mod.CLAVE_SESION]: JSON.stringify({ vence: reloj - 1, rutas: ['thumbs/a.jpg'] }),
    })
    list.mockResolvedValueOnce(ok([archivo('a.jpg'), archivo('b.jpg')]))
    const registro = crear({ almacen: () => almacen })
    expect(registro.disponibles()?.has('thumbs/a.jpg')).toBe(true)
    await registro.cargar()
    expect(list).toHaveBeenCalledTimes(1)
    expect(registro.disponibles()?.has('thumbs/b.jpg')).toBe(true)
  })

  it('una vigencia guardada absurda (reloj movido) no pasa del TTL', async () => {
    const almacen = almacenFalso({
      [mod.CLAVE_SESION]: JSON.stringify({ vence: reloj + 365 * 24 * 60 * MIN, rutas: [] }),
    })
    list.mockResolvedValue(ok([]))
    const registro = crear({ almacen: () => almacen })
    await registro.cargar()
    expect(list).not.toHaveBeenCalled()
    reloj += mod.TTL_REGISTRO_MS
    await registro.cargar()
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('dato corrupto: se ignora y se lista de cero', async () => {
    for (const malo of ['{no es json', '{"vence":"x","rutas":[]}', '{"vence":1,"rutas":[1]}', 'null']) {
      const almacen = almacenFalso({ [mod.CLAVE_SESION]: malo })
      expect(crear({ almacen: () => almacen }).disponibles()).toBeNull()
    }
  })

  it('sessionStorage inaccesible (el acceso tira): funciona solo en memoria', async () => {
    list.mockResolvedValue(ok([archivo('a.jpg')]))
    const registro = crear({
      almacen: () => {
        throw new DOMException('bloqueado', 'SecurityError')
      },
    })
    expect(registro.disponibles()).toBeNull()
    await expect(registro.cargar()).resolves.toEqual(new Set(['thumbs/a.jpg']))
    registro.agregar('thumbs/b.jpg')
    expect(registro.disponibles()?.has('thumbs/b.jpg')).toBe(true)
  })

  it('getItem/setItem que tiran (cuota llena): tampoco rompe', async () => {
    list.mockResolvedValue(ok([archivo('a.jpg')]))
    const almacen = {
      getItem: vi.fn(() => {
        throw new Error('no')
      }),
      setItem: vi.fn(() => {
        throw new DOMException('lleno', 'QuotaExceededError')
      }),
    }
    const registro = crear({ almacen: () => almacen })
    await expect(registro.cargar()).resolves.toEqual(new Set(['thumbs/a.jpg']))
    expect(almacen.setItem).toHaveBeenCalled()
  })
})

// ---- agregar / suscribir ----------------------------------------------------------------

describe('agregar', () => {
  it('aparece al instante, avisa y sobrevive a un listado que todavía no la trae', async () => {
    const almacen = almacenFalso()
    const registro = crear({ almacen: () => almacen })
    const oyente = vi.fn()
    const soltar = registro.suscribir(oyente)

    registro.agregar('thumbs/nueva.jpg')
    expect(registro.disponibles()?.has('thumbs/nueva.jpg')).toBe(true)
    expect(oyente).toHaveBeenCalledTimes(1)
    expect(almacen.datos.get(mod.CLAVE_SESION)).toContain('thumbs/nueva.jpg')

    list.mockResolvedValueOnce(ok([archivo('a.jpg')])) // listado viejo, sin la nueva
    const rutas = await registro.cargar()
    expect([...(rutas ?? [])].sort()).toEqual(['thumbs/a.jpg', 'thumbs/nueva.jpg'])

    soltar()
    registro.agregar('thumbs/otra.jpg')
    expect(oyente).toHaveBeenCalledTimes(2) // agregar + listado; nada después de soltar
  })

  it('agregar una que ya figura no avisa de nuevo', async () => {
    list.mockResolvedValueOnce(ok([archivo('a.jpg')]))
    const registro = crear()
    await registro.cargar()
    const oyente = vi.fn()
    registro.suscribir(oyente)
    registro.agregar('thumbs/a.jpg')
    expect(oyente).not.toHaveBeenCalled()
  })
})

// ---- Qué src muestra <Miniatura> ---------------------------------------------------------

describe('elegirFuente', () => {
  const original = `${PUB}3f2a.jpg`
  const miniatura = `${PUB}thumbs/3f2a.jpg`
  const nada = { fallida: null, originalCargado: null }
  const conMiniatura = new Set(['thumbs/3f2a.jpg'])

  it('registro sin cargar: el original', () => {
    expect(mod.elegirFuente(original, null, nada)).toBe(original)
  })

  it('miniatura confirmada por el registro: la miniatura', () => {
    expect(mod.elegirFuente(original, conMiniatura, nada)).toBe(miniatura)
  })

  it('miniatura que no figura: el original (nunca se pide a ciegas)', () => {
    expect(mod.elegirFuente(original, new Set(['thumbs/otra.jpg']), nada)).toBe(original)
  })

  it('miniatura que falló: vuelve al original', () => {
    expect(mod.elegirFuente(original, conMiniatura, { fallida: miniatura, originalCargado: null })).toBe(
      original,
    )
  })

  it('original ya cargado en pantalla: no se reemplaza', () => {
    expect(mod.elegirFuente(original, conMiniatura, { fallida: null, originalCargado: original })).toBe(
      original,
    )
    // ...salvo que sea de otra foto (el src cambió).
    expect(
      mod.elegirFuente(original, conMiniatura, { fallida: null, originalCargado: `${PUB}vieja.jpg` }),
    ).toBe(miniatura)
  })

  it('nombres codificados: busca la ruta sin codificar y devuelve la URL codificada', () => {
    const conEspacio = `${PUB}foto%20vieja.png`
    expect(mod.elegirFuente(conEspacio, new Set(['thumbs/foto vieja.jpg']), nada)).toBe(
      `${PUB}thumbs/foto%20vieja.jpg`,
    )
  })

  it('placeholder y URLs ajenas: tal cual', () => {
    expect(mod.elegirFuente('data:image/svg+xml,x', conMiniatura, nada)).toBe('data:image/svg+xml,x')
    expect(mod.elegirFuente('https://otro.com/3f2a.jpg', conMiniatura, nada)).toBe(
      'https://otro.com/3f2a.jpg',
    )
  })
})
