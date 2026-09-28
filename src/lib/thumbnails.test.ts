import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// El cliente real exige variables de entorno y habla con la red: se reemplaza
// por un Storage y una sesión simulados (vi.hoisted para que existan cuando
// corre vi.mock). Las miniaturas se suben con fetch (ver stubNavegador).
const storage = vi.hoisted(() => ({ list: vi.fn(), upload: vi.fn(), getPublicUrl: vi.fn() }))
const from = vi.hoisted(() => vi.fn())
const getSession = vi.hoisted(() => vi.fn())
vi.mock('./supabaseClient', () => ({ supabase: { storage: { from }, auth: { getSession } } }))

type GenerarUna = import('./thumbnails').GenerarUna
type ResumenPasada = import('./thumbnails').ResumenPasada
type Entorno = import('./thumbnails').EntornoAutomatico

const BASE = 'https://proyecto.supabase.co'
const PUB = `${BASE}/storage/v1/object/public/productos/`
const API = `${BASE}/storage/v1/object/productos/`
const ANON = 'clave-anon'
const TOKEN = 'token-de-la-admin'
const MIN = 60_000
// Subida del ORIGINAL (supabase-js, en subirOriginalConMiniatura).
const OPCIONES_SUBIDA = { cacheControl: '31536000', upsert: false, contentType: 'image/jpeg' }
// Cuerpo con el que Storage contesta un duplicado (HTTP 409, o 400 en versiones viejas).
const DUPLICADO = { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }

let t: typeof import('./thumbnails')
let reg: typeof import('./miniaturasDisponibles')

// Módulos nuevos en cada test: images.ts lee VITE_SUPABASE_URL al cargarse y
// thumbnails.ts guarda qué fotos están en proceso.
beforeEach(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', BASE)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON)
  vi.resetModules()
  t = await import('./thumbnails')
  reg = await import('./miniaturasDisponibles')

  from.mockReset().mockReturnValue(storage)
  storage.list.mockReset().mockResolvedValue({ data: [], error: null })
  storage.upload.mockReset().mockImplementation(async (ruta: string) => ({ data: { path: ruta }, error: null }))
  storage.getPublicUrl
    .mockReset()
    .mockImplementation((ruta: string) => ({ data: { publicUrl: PUB + ruta } }))
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: TOKEN } }, error: null })
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// ---- Dobles ---------------------------------------------------------------------

const archivo = (name: string) => ({ name, id: `id-${name}`, metadata: { size: 1 } })
const listado = (...nombres: string[]) => ({ data: nombres.map(archivo), error: null })
// Como los StorageError de supabase-js: un Error con statusCode.
const errorStorage = (statusCode: string, message: string) =>
  Object.assign(new Error(message), { statusCode })
const falla = (statusCode: string, message: string) => ({
  data: null,
  error: errorStorage(statusCode, message),
})
const registro = () => reg.crearRegistroMiniaturas({ almacen: () => null })

function diferida<T>() {
  let resolver!: (valor: T) => void
  const promesa = new Promise<T>((r) => {
    resolver = r
  })
  return { promesa, resolver }
}

// Deja correr las promesas pendientes (con timers reales).
const vaciar = () => new Promise<void>((r) => setTimeout(r, 0))

// Respuesta mínima de fetch. Sin `cuerpo`, json() falla (cuerpo vacío o HTML).
function respuesta(status: number, cuerpo?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    blob: async () => new Blob(['original']),
    json: async () => {
      if (cuerpo === undefined) throw new SyntaxError('Unexpected end of JSON input')
      return cuerpo
    },
  }
}
type Respuesta = ReturnType<typeof respuesta>
type Subida = (url: string, init: RequestInit) => Promise<Respuesta>

// Subida que no contesta nunca: solo termina (rechazada) si se aborta su señal,
// como un fetch real.
const colgada: Subida = (_url, init) =>
  new Promise<Respuesta>((_listo, rechazar) => {
    init.signal?.addEventListener('abort', () =>
      rechazar(new DOMException('The operation was aborted.', 'AbortError')),
    )
  })

// Navegador mínimo: fetch (GET = bajar el original, POST = subir la
// miniatura a Storage), createImageBitmap y un canvas para crearMiniatura.
function stubNavegador({ ancho = 1600, alto = 1200, subida }: { ancho?: number; alto?: number; subida?: Subida } = {}) {
  const descargar = vi.fn(async (_url: string, _init?: RequestInit) => respuesta(200))
  const subir = vi.fn<Subida>(subida ?? (async () => respuesta(200, { Key: 'productos/x' })))
  const fetchMock = vi.fn((url: string, init?: RequestInit) =>
    init?.method === 'POST' ? subir(url, init) : descargar(url, init),
  )
  vi.stubGlobal('fetch', fetchMock)
  const bitmap = { width: ancho, height: alto, close: vi.fn() }
  const createImageBitmap = vi.fn(async () => bitmap)
  vi.stubGlobal('createImageBitmap', createImageBitmap)
  const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn(), imageSmoothingQuality: 'low' }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toBlob: vi.fn((listo: (b: Blob | null) => void, tipo: string) => listo(new Blob(['mini'], { type: tipo }))),
  }
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
  // Señal de cada subida de miniatura, en orden.
  const señales = () => subir.mock.calls.map(([, init]) => init.signal as AbortSignal)
  return { fetchMock, descargar, subir, señales, createImageBitmap, bitmap, ctx, canvas }
}

// ---- Una pasada -----------------------------------------------------------------------

describe('generarMiniaturasFaltantes', () => {
  it('solo procesa los originales sin miniatura, sin repetir, y los anota en el registro', async () => {
    storage.list.mockResolvedValue(listado('a.jpg'))
    const r = registro()
    const generar = vi.fn<GenerarUna>(async () => 'generada')

    const resumen = await t.generarMiniaturasFaltantes(['a.jpg', 'b.png', 'c.jpg', 'b.png'], {
      registro: r,
      generar,
    })

    expect(generar.mock.calls.map(([ruta]) => ruta)).toEqual(['b.png', 'c.jpg'])
    expect(resumen).toEqual({
      total: 3,
      faltaban: 2,
      generadas: 2,
      yaExistian: 0,
      errores: 0,
      pendientes: 0,
      listada: true,
      completa: true,
    })
    expect(r.disponibles()).toEqual(new Set(['thumbs/a.jpg', 'thumbs/b.jpg', 'thumbs/c.jpg']))
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('2 generadas'))
  })

  it('lista de nuevo aunque el registro esté vigente (no confía en un listado de hace minutos)', async () => {
    const r = registro()
    await r.cargar()
    await t.generarMiniaturasFaltantes(['a.jpg'], { registro: r, generar: async () => 'generada' })
    expect(storage.list).toHaveBeenCalledTimes(2)
  })

  it('sin listado (Storage falla) no genera nada y no cuenta como completa', async () => {
    storage.list.mockResolvedValue(falla('403', 'permission denied'))
    const generar = vi.fn<GenerarUna>(async () => 'generada')
    const resumen = await t.generarMiniaturasFaltantes(['a.jpg'], { registro: registro(), generar })
    expect(generar).not.toHaveBeenCalled()
    expect(resumen).toMatchObject({ listada: false, completa: false })
  })

  it('todo al día: no sube nada y lo dice en consola', async () => {
    storage.list.mockResolvedValue(listado('a.jpg', 'b.jpg'))
    const generar = vi.fn<GenerarUna>(async () => 'generada')
    const resumen = await t.generarMiniaturasFaltantes(['a.jpg', 'b.png'], { registro: registro(), generar })
    expect(generar).not.toHaveBeenCalled()
    expect(resumen).toMatchObject({ faltaban: 0, completa: true })
    expect(console.info).toHaveBeenCalledWith('[Miniaturas] Todas las fotos tienen miniatura (2).')
  })

  it('un error o un cuelgue no frenan a las demás', async () => {
    vi.useFakeTimers()
    const generar = vi.fn<GenerarUna>(async (ruta) => {
      if (ruta === 'a.jpg') throw new Error('boom')
      if (ruta === 'b.jpg') return new Promise<never>(() => {}) // nunca responde
      return 'generada'
    })
    const promesa = t.generarMiniaturasFaltantes(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'], {
      registro: registro(),
      generar,
      tiempoMax: 1000,
    })
    await vi.advanceTimersByTimeAsync(1000)
    const resumen = await promesa

    expect(generar).toHaveBeenCalledTimes(4)
    expect(resumen).toMatchObject({ faltaban: 4, generadas: 2, errores: 2, pendientes: 0, completa: true })
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"a.jpg" (boom)'))
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"b.jpg" (sin respuesta en 1 s)'))
  })

  it('pasado el tope, si la subida termina igual queda anotada', async () => {
    vi.useFakeTimers()
    const r = registro()
    const promesa = t.generarMiniaturasFaltantes(['lenta.jpg'], {
      registro: r,
      tiempoMax: 1000,
      generar: () => new Promise((listo) => setTimeout(() => listo('generada'), 3000)),
    })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(promesa).resolves.toMatchObject({ errores: 1 })
    expect(r.disponibles()?.has('thumbs/lenta.jpg')).toBe(false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(r.disponibles()?.has('thumbs/lenta.jpg')).toBe(true)
  })

  it('de a 2 como máximo por defecto (memoria en celulares)', async () => {
    vi.useFakeTimers()
    let activas = 0
    let maximo = 0
    const generar: GenerarUna = async () => {
      activas++
      maximo = Math.max(maximo, activas)
      await new Promise((listo) => setTimeout(listo, 10))
      activas--
      return 'generada'
    }
    const promesa = t.generarMiniaturasFaltantes(['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg'], {
      registro: registro(),
      generar,
    })
    await vi.advanceTimersByTimeAsync(100)
    await expect(promesa).resolves.toMatchObject({ generadas: 5 })
    expect(t.A_LA_VEZ).toBe(2)
    expect(maximo).toBe(2)
  })

  it('detener: no arranca fotos nuevas, las que están en curso terminan y no cuenta como completa', async () => {
    const pendientes = new Map<string, ReturnType<typeof diferida<'generada'>>>()
    const señales: AbortSignal[] = []
    const generar = vi.fn<GenerarUna>((ruta, signal) => {
      const d = diferida<'generada'>()
      pendientes.set(ruta, d)
      señales.push(signal)
      return d.promesa
    })
    const detener = new AbortController()
    const r = registro()
    const promesa = t.generarMiniaturasFaltantes(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'], {
      registro: r,
      generar,
      detener: detener.signal,
    })
    await vaciar()
    expect([...pendientes.keys()]).toEqual(['a.jpg', 'b.jpg'])

    detener.abort() // la pestaña pasó a segundo plano
    pendientes.get('a.jpg')!.resolver('generada')
    pendientes.get('b.jpg')!.resolver('generada')
    const resumen = await promesa

    expect(generar).toHaveBeenCalledTimes(2)
    expect(señales.every((s) => !s.aborted)).toBe(true)
    expect(resumen).toMatchObject({ faltaban: 4, generadas: 2, pendientes: 2, errores: 0, completa: false })
    expect(r.disponibles()).toEqual(new Set(['thumbs/a.jpg', 'thumbs/b.jpg']))
  })

  it('no repite una foto que otra pasada está procesando', async () => {
    const d = diferida<'generada'>()
    const primera = vi.fn<GenerarUna>(() => d.promesa)
    const segunda = vi.fn<GenerarUna>(async () => 'generada')
    const r = registro()

    const p1 = t.generarMiniaturasFaltantes(['a.jpg'], { registro: r, generar: primera })
    await vaciar()
    expect(primera).toHaveBeenCalledTimes(1)

    const r2 = await t.generarMiniaturasFaltantes(['a.jpg', 'b.jpg'], { registro: r, generar: segunda })
    expect(segunda.mock.calls.map(([ruta]) => ruta)).toEqual(['b.jpg'])
    expect(r2.faltaban).toBe(1)

    d.resolver('generada')
    await expect(p1).resolves.toMatchObject({ generadas: 1 })
  })

  it('vencido el tope suelta la foto aunque la tarea no termine nunca: otra pasada la reintenta', async () => {
    vi.useFakeTimers()
    const r = registro()
    const colgadaParaSiempre = vi.fn<GenerarUna>(() => new Promise<never>(() => {}))
    const primera = t.generarMiniaturasFaltantes(['a.jpg'], {
      registro: r,
      generar: colgadaParaSiempre,
      tiempoMax: 1000,
    })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(primera).resolves.toMatchObject({ errores: 1 })
    expect(colgadaParaSiempre.mock.calls[0][1].aborted).toBe(true)

    const otra = vi.fn<GenerarUna>(async () => 'generada')
    const resumen = await t.generarMiniaturasFaltantes(['a.jpg'], { registro: r, generar: otra })
    expect(otra).toHaveBeenCalledWith('a.jpg', expect.any(AbortSignal))
    expect(resumen).toMatchObject({ faltaban: 1, generadas: 1 })
  })

  it('una tarea vencida que termina tarde no suelta la foto que ya tomó otra pasada', async () => {
    vi.useFakeTimers()
    const vieja = diferida<'generada'>()
    const primera = t.generarMiniaturasFaltantes(['a.jpg'], {
      registro: registro(),
      generar: () => vieja.promesa,
      tiempoMax: 1000,
    })
    await vi.advanceTimersByTimeAsync(1000)
    await primera

    const nueva = diferida<'generada'>()
    const segunda = t.generarMiniaturasFaltantes(['a.jpg'], { registro: registro(), generar: () => nueva.promesa })
    await vi.advanceTimersByTimeAsync(0)
    vieja.resolver('generada') // la vieja termina recién ahora
    await vi.advanceTimersByTimeAsync(0)

    const tercera = vi.fn<GenerarUna>(async () => 'generada')
    const resumen = await t.generarMiniaturasFaltantes(['a.jpg'], { registro: registro(), generar: tercera })
    expect(tercera).not.toHaveBeenCalled() // la segunda la sigue teniendo
    expect(resumen.faltaban).toBe(0)

    nueva.resolver('generada')
    await expect(segunda).resolves.toMatchObject({ generadas: 1 })
  })
})

// ---- Generación real (bajar, achicar, subir) con el navegador simulado ------------------

describe('generarMiniaturasFaltantes con la generación por defecto', () => {
  it('baja el original, lo achica a 480 px y sube thumbs/<ruta>.jpg sin pisar nada', async () => {
    const nav = stubNavegador()
    const r = registro()
    const resumen = await t.generarMiniaturasFaltantes(['a.png'], { registro: r })

    expect(resumen).toMatchObject({ generadas: 1, errores: 0, completa: true })
    expect(storage.getPublicUrl).toHaveBeenCalledWith('a.png')
    expect(nav.descargar).toHaveBeenCalledWith(`${PUB}a.png`, expect.objectContaining({ mode: 'cors' }))
    expect(nav.ctx.drawImage).toHaveBeenCalledWith(nav.bitmap, 0, 0, 480, 360)
    expect(nav.subir).toHaveBeenCalledWith(`${API}thumbs/a.jpg`, expect.objectContaining({ method: 'POST' }))
    expect((nav.subir.mock.calls[0][1].body as Blob).type).toBe('image/jpeg')
    expect(storage.upload).not.toHaveBeenCalled()
    expect(r.disponibles()?.has('thumbs/a.jpg')).toBe(true)
  })

  it('409: la que ya existía cuenta como lista y queda anotada', async () => {
    const nav = stubNavegador()
    nav.subir.mockImplementation(async (url) =>
      url === `${API}thumbs/b.jpg` ? respuesta(409, DUPLICADO) : respuesta(200, {}),
    )
    const r = registro()
    const resumen = await t.generarMiniaturasFaltantes(['a.jpg', 'b.jpg'], { registro: r })

    expect(resumen).toMatchObject({ faltaban: 2, generadas: 1, yaExistian: 1, errores: 0, completa: true })
    expect(r.disponibles()).toEqual(new Set(['thumbs/a.jpg', 'thumbs/b.jpg']))
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('si todas "ya existían", avisa que el listado no las muestra (política de Storage)', async () => {
    const nav = stubNavegador()
    nav.subir.mockResolvedValue(respuesta(400, DUPLICADO))
    await t.generarMiniaturasFaltantes(['a.jpg'], { registro: registro() })
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('política de lectura'))
  })

  it('original que no baja o subida rechazada: error con aviso, sin frenar al resto', async () => {
    const nav = stubNavegador()
    nav.descargar.mockImplementation(async (url: string) => respuesta(url.endsWith('borrada.jpg') ? 400 : 200))
    nav.subir.mockImplementation(async (url) =>
      url === `${API}thumbs/prohibida.jpg`
        ? respuesta(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' })
        : respuesta(200, {}),
    )
    const r = registro()
    const resumen = await t.generarMiniaturasFaltantes(['borrada.jpg', 'prohibida.jpg', 'bien.jpg'], {
      registro: r,
    })

    expect(resumen).toMatchObject({ generadas: 1, errores: 2, completa: true })
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"borrada.jpg" (HTTP 400'))
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('"prohibida.jpg" (HTTP 403 Unauthorized: new row violates'),
    )
    expect(r.disponibles()).toEqual(new Set(['thumbs/bien.jpg']))
  })

  it('vencido el tope corta la subida de verdad y recién ahí arranca otra (nunca más de 2 en la red)', async () => {
    vi.useFakeTimers()
    const nav = stubNavegador({ subida: colgada })
    const enRed = () => nav.señales().filter((s) => !s.aborted).length
    const promesa = t.generarMiniaturasFaltantes(['1.jpg', '2.jpg', '3.jpg'], {
      registro: registro(),
      tiempoMax: 1000,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(nav.subir).toHaveBeenCalledTimes(2)
    expect(enRed()).toBe(2)

    await vi.advanceTimersByTimeAsync(1000)
    expect(nav.subir).toHaveBeenCalledTimes(3)
    expect(nav.señales()[0].aborted).toBe(true)
    expect(nav.señales()[1].aborted).toBe(true)
    expect(enRed()).toBe(1)

    await vi.advanceTimersByTimeAsync(1000)
    await expect(promesa).resolves.toMatchObject({ faltaban: 3, errores: 3, pendientes: 0 })
    expect(enRed()).toBe(0)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"3.jpg" (sin respuesta en 1 s)'))
  })
})

// ---- La subida en sí: fetch directo a la API de Storage -------------------------------------

describe('subida de la miniatura', () => {
  it('POST abortable con el token de la sesión, sin pisar, como JPEG y con caché de un año', async () => {
    const nav = stubNavegador()
    await expect(t.subirMiniatura('carpeta/c d#1.png', new Blob(['x']), registro())).resolves.toBe(true)
    expect(nav.subir).toHaveBeenCalledWith(`${API}thumbs/carpeta/c%20d%231.jpg`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        apikey: ANON,
        'x-upsert': 'false',
        'content-type': 'image/jpeg',
        'cache-control': 'max-age=31536000',
      },
      body: expect.any(Blob),
      signal: expect.any(AbortSignal),
    })
  })

  it('sin sesión usa la clave anon como token (como supabase-js)', async () => {
    const nav = stubNavegador()
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    await t.subirMiniatura('nuevo.jpg', new Blob(['x']), registro())
    const headers = nav.subir.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${ANON}`)
  })

  it.each([
    [201, { Key: 'productos/thumbs/nuevo.jpg' }, 'generada'],
    [409, DUPLICADO, 'yaExistia'],
    [400, DUPLICADO, 'yaExistia'], // Storage viejo: HTTP 400 con statusCode "409"
  ] as const)('HTTP %i -> %s', async (status, cuerpo, esperado) => {
    const nav = stubNavegador()
    nav.subir.mockResolvedValue(respuesta(status, cuerpo))
    const resumen = await t.generarMiniaturasFaltantes(['nuevo.jpg'], { registro: registro() })
    expect(resumen).toMatchObject(
      esperado === 'generada' ? { generadas: 1, errores: 0 } : { yaExistian: 1, errores: 0 },
    )
  })

  it.each([
    [401, { statusCode: '403', error: 'Unauthorized', message: 'jwt expired' }, 'HTTP 401 Unauthorized: jwt expired'],
    [500, undefined, 'HTTP 500'], // sin cuerpo JSON
  ] as const)('HTTP %i -> falla con el código y el mensaje en consola', async (status, cuerpo, texto) => {
    const nav = stubNavegador()
    nav.subir.mockResolvedValue(respuesta(status, cuerpo))
    const r = registro()
    await expect(t.subirMiniatura('nuevo.jpg', new Blob(['x']), r)).resolves.toBe(false)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`"nuevo.jpg" (${texto}`))
    expect(r.disponibles()).toBeNull()
  })
})

// ---- Junto con la foto nueva ----------------------------------------------------------------

describe('subirMiniatura', () => {
  it('sube la miniatura del original recién subido y la anota', async () => {
    const nav = stubNavegador()
    const r = registro()
    await expect(t.subirMiniatura('nuevo.jpg', new Blob(['x']), r)).resolves.toBe(true)
    expect(nav.subir).toHaveBeenCalledWith(`${API}thumbs/nuevo.jpg`, expect.objectContaining({ method: 'POST' }))
    expect(r.disponibles()?.has('thumbs/nuevo.jpg')).toBe(true)
  })

  it('409 también cuenta como lista', async () => {
    const nav = stubNavegador()
    nav.subir.mockResolvedValue(respuesta(409, DUPLICADO))
    const r = registro()
    await expect(t.subirMiniatura('nuevo.jpg', new Blob(['x']), r)).resolves.toBe(true)
    expect(r.disponibles()?.has('thumbs/nuevo.jpg')).toBe(true)
  })

  it('si falla la subida no rechaza: avisa y devuelve false', async () => {
    const nav = stubNavegador()
    nav.subir.mockResolvedValue(respuesta(500, { statusCode: '500', error: 'Internal', message: 'boom' }))
    const r = registro()
    await expect(t.subirMiniatura('nuevo.jpg', new Blob(['x']), r)).resolves.toBe(false)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"nuevo.jpg"'))
    expect(r.disponibles()).toBeNull()
  })

  it('si no se puede achicar la imagen tampoco rechaza (y no sube nada)', async () => {
    const nav = stubNavegador()
    nav.createImageBitmap.mockRejectedValue(new Error('formato raro'))
    await expect(t.subirMiniatura('nuevo.jpg', new Blob(['x']), registro())).resolves.toBe(false)
    expect(nav.subir).not.toHaveBeenCalled()
  })

  it('si la subida se cuelga, al tope la corta de verdad y suelta la foto para la pasada', async () => {
    vi.useFakeTimers()
    const nav = stubNavegador({ subida: colgada })
    const promesa = t.subirMiniatura('nuevo.jpg', new Blob(['x']), registro())
    await vi.advanceTimersByTimeAsync(0)
    expect(nav.señales()[0].aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(t.TOPE_MINIATURA_AL_GUARDAR_MS)
    await expect(promesa).resolves.toBe(false)
    expect(nav.señales()[0].aborted).toBe(true)

    const generar = vi.fn<GenerarUna>(async () => 'generada')
    await t.generarMiniaturasFaltantes(['nuevo.jpg'], { registro: registro(), generar })
    expect(generar).toHaveBeenCalledTimes(1)
  })
})

describe('subirOriginalConMiniatura', () => {
  it('si falla el original, rechaza en el acto sin esperar a la miniatura', async () => {
    vi.useFakeTimers()
    const nav = stubNavegador({ subida: colgada }) // la miniatura no contesta
    const errorOriginal = errorStorage('403', 'new row violates row-level security policy')
    storage.upload.mockImplementation(
      () => new Promise((listo) => setTimeout(() => listo({ data: null, error: errorOriginal }), 100)),
    )

    let resultado: unknown = 'pendiente'
    t.subirOriginalConMiniatura('nuevo.jpg', new Blob(['x'])).then(
      () => {
        resultado = 'ok'
      },
      (error: unknown) => {
        resultado = error
      },
    )
    await vi.advanceTimersByTimeAsync(100)

    expect(resultado).toBe(errorOriginal) // a los 100 ms, no a los 20 s
    expect(storage.upload).toHaveBeenCalledWith('nuevo.jpg', expect.any(Blob), OPCIONES_SUBIDA)
    // La miniatura iba en paralelo y sigue sola hasta su tope, donde se corta.
    expect(nav.señales()).toHaveLength(1)
    expect(nav.señales()[0].aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(t.TOPE_MINIATURA_AL_GUARDAR_MS)
    expect(nav.señales()[0].aborted).toBe(true)
  })

  it('si el original sube bien, no espera a la miniatura: se anota sola al terminar', async () => {
    vi.useFakeTimers()
    const lista = diferida<Respuesta>()
    const nav = stubNavegador({ subida: () => lista.promesa })

    let resultado = 'pendiente'
    void t.subirOriginalConMiniatura('nuevo.jpg', new Blob(['x'])).then(() => {
      resultado = 'ok'
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(resultado).toBe('ok')
    expect(nav.subir).toHaveBeenCalledTimes(1) // salió en paralelo
    expect(reg.registroMiniaturas.disponibles()).toBeNull()

    lista.resolver(respuesta(200, {}))
    await vi.advanceTimersByTimeAsync(0)
    expect(reg.registroMiniaturas.disponibles()?.has('thumbs/nuevo.jpg')).toBe(true)
  })

  it('mientras sube la miniatura de una foto nueva, la pasada automática no la repite', async () => {
    const lista = diferida<Respuesta>()
    stubNavegador({ subida: () => lista.promesa })
    await t.subirOriginalConMiniatura('nuevo.jpg', new Blob(['x']))

    const generar = vi.fn<GenerarUna>(async () => 'generada')
    const resumen = await t.generarMiniaturasFaltantes(['nuevo.jpg', 'otra.jpg'], {
      registro: registro(),
      generar,
    })
    expect(generar.mock.calls.map(([ruta]) => ruta)).toEqual(['otra.jpg'])
    expect(resumen.faltaban).toBe(1)

    lista.resolver(respuesta(200, {}))
    await vaciar()
  })
})

// ---- Utilidades ----------------------------------------------------------------------------

describe('rutasOriginales', () => {
  it('rutas de nuestro bucket, sin repetir, sin miniaturas ni URLs ajenas, en orden', () => {
    const productos = [
      { imagenes: [`${PUB}a.jpg`, `${PUB}b.png`], imagen_url: `${PUB}a.jpg` },
      { imagenes: [`${PUB}thumbs/a.jpg`, 'https://otro.com/x.jpg', `${PUB}c%20d.jpg`], imagen_url: null },
      { imagenes: null, imagen_url: `${PUB}vieja.webp` },
      { imagenes: [], imagen_url: null },
      { imagenes: ['data:image/svg+xml,x', ''], imagen_url: `${PUB}b.png` },
    ]
    expect(t.rutasOriginales(productos)).toEqual(['a.jpg', 'b.png', 'c d.jpg', 'vieja.webp'])
  })
})

describe('firmaDeRutas', () => {
  it('no depende del orden ni de repetidos', () => {
    expect(t.firmaDeRutas(['a.jpg', 'b.jpg'])).toBe(t.firmaDeRutas(['b.jpg', 'a.jpg', 'a.jpg']))
  })

  it('cambia si se agrega o se quita una foto', () => {
    const base = t.firmaDeRutas(['a.jpg', 'b.jpg'])
    expect(t.firmaDeRutas(['a.jpg', 'b.jpg', 'c.jpg'])).not.toBe(base)
    expect(t.firmaDeRutas(['a.jpg'])).not.toBe(base)
    expect(t.firmaDeRutas(['a.jpg', 'x.jpg'])).not.toBe(base)
  })

  it('separa las rutas (["ab","c"] no es ["a","bc"])', () => {
    expect(t.firmaDeRutas(['ab', 'c'])).not.toBe(t.firmaDeRutas(['a', 'bc']))
  })
})

describe('yaExiste', () => {
  it('reconoce el duplicado de Storage en sus distintas formas', () => {
    expect(t.yaExiste({ statusCode: '409', message: 'x' })).toBe(true)
    expect(t.yaExiste({ status: 409 })).toBe(true)
    expect(t.yaExiste({ message: 'The resource already exists' })).toBe(true)
    expect(t.yaExiste({ message: 'Duplicate' })).toBe(true)
    expect(t.yaExiste({ statusCode: '403', message: 'row-level security' })).toBe(false)
  })
})

// ---- Automáticas: cuándo corre la pasada ---------------------------------------------------------

describe('crearMiniaturasAutomaticas', () => {
  const COMPLETA: ResumenPasada = {
    total: 1,
    faltaban: 0,
    generadas: 0,
    yaExistian: 0,
    errores: 0,
    pendientes: 0,
    listada: true,
    completa: true,
  }
  const INCOMPLETA: ResumenPasada = { ...COMPLETA, faltaban: 1, pendientes: 1, completa: false }
  const CON_ERRORES: ResumenPasada = { ...COMPLETA, faltaban: 1, errores: 1 }
  const TODAS_YA_EXISTIAN: ResumenPasada = { ...COMPLETA, faltaban: 2, yaExistian: 2 }
  const SIN_LISTADO: ResumenPasada = { ...COMPLETA, listada: false, completa: false }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  const avanzar = (ms: number) => vi.advanceTimersByTimeAsync(ms)

  function almacenFalso() {
    const datos = new Map<string, string>()
    return {
      datos,
      getItem: (clave: string) => datos.get(clave) ?? null,
      setItem: (clave: string, valor: string) => {
        datos.set(clave, valor)
      },
    }
  }

  function preparar(
    opciones: {
      pasada?: Entorno['pasada']
      visibilidad?: DocumentVisibilityState
      almacen?: Entorno['almacen']
      ahorroDeDatos?: () => boolean
    } = {},
  ) {
    const pasada = vi.fn<Entorno['pasada']>(opciones.pasada ?? (async () => COMPLETA))
    const oyentes = new Set<() => void>()
    const doc = {
      visibilityState: opciones.visibilidad ?? ('visible' as DocumentVisibilityState),
      addEventListener: vi.fn((_tipo: string, fn: () => void) => {
        oyentes.add(fn)
      }),
      removeEventListener: vi.fn((_tipo: string, fn: () => void) => {
        oyentes.delete(fn)
      }),
    }
    const cambiar = (estado: DocumentVisibilityState) => {
      doc.visibilityState = estado
      oyentes.forEach((fn) => fn())
    }
    const almacen = almacenFalso()
    const avisos = vi.fn<(necesita: boolean) => void>()
    const auto = t.crearMiniaturasAutomaticas(
      {
        pasada,
        documento: doc,
        almacen: opciones.almacen ?? (() => almacen),
        ahorroDeDatos: opciones.ahorroDeDatos ?? (() => false),
        ahora: () => Date.now(),
      },
      { alCambiarAtencion: avisos },
    )
    return { auto, pasada, doc, cambiar, oyentes, almacen, avisos }
  }

  // Una pasada por firma (cambiar las fotos saltea el "una cada 30 min").
  async function pasadas(auto: import('./thumbnails').MiniaturasAutomaticas, firmas: string[]) {
    for (const firma of firmas) {
      auto.actualizar(['a.jpg'], firma)
      await avanzar(5000)
    }
  }

  it('espera 5 s de calma antes de la primera pasada', async () => {
    const { auto, pasada } = preparar()
    auto.actualizar(['a.jpg'], 'f1')
    await avanzar(4999)
    expect(pasada).not.toHaveBeenCalled()
    await avanzar(1)
    expect(pasada).toHaveBeenCalledTimes(1)
    expect(pasada).toHaveBeenCalledWith(['a.jpg'], expect.any(AbortSignal))
  })

  it('sin fotos no programa nada', async () => {
    const { auto, pasada } = preparar()
    auto.actualizar([], 'vacia')
    await avanzar(60_000)
    expect(pasada).not.toHaveBeenCalled()
  })

  it('con "ahorro de datos" no corre nunca (y lo avisa una sola vez)', async () => {
    const { auto, pasada } = preparar({ ahorroDeDatos: () => true })
    auto.actualizar(['a.jpg'], 'f1')
    await avanzar(5000)
    auto.actualizar(['a.jpg', 'b.jpg'], 'f2')
    await avanzar(5000)
    expect(pasada).not.toHaveBeenCalled()
    expect(console.info).toHaveBeenCalledTimes(1)
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Ahorro de datos'))
  })

  it('ahorro de datos por defecto: navigator.connection.saveData', async () => {
    vi.stubGlobal('navigator', { connection: { saveData: true } })
    const pasada = vi.fn<Entorno['pasada']>(async () => COMPLETA)
    const auto = t.crearMiniaturasAutomaticas({ pasada, documento: null })
    auto.actualizar(['a.jpg'], 'f1')
    await avanzar(10_000)
    expect(pasada).not.toHaveBeenCalled()
  })

  it('como mucho una pasada completa cada 30 min con las mismas fotos', async () => {
    const almacen = almacenFalso()
    const conAlmacen = () => almacen

    const primera = preparar({ almacen: conAlmacen })
    primera.auto.actualizar(['a.jpg'], 'f1')
    await avanzar(5000)
    expect(primera.pasada).toHaveBeenCalledTimes(1)
    expect(JSON.parse(almacen.datos.get(t.CLAVE_ULTIMA_PASADA) ?? '{}')).toMatchObject({ firma: 'f1' })
    primera.auto.destruir()

    // Se vuelve a abrir el panel a los 29 min: no repite.
    await avanzar(29 * MIN)
    const segunda = preparar({ almacen: conAlmacen })
    segunda.auto.actualizar(['a.jpg'], 'f1')
    await avanzar(5000)
    expect(segunda.pasada).not.toHaveBeenCalled()
    segunda.auto.destruir()

    // Pasados los 30 min, sí.
    await avanzar(1 * MIN)
    const tercera = preparar({ almacen: conAlmacen })
    tercera.auto.actualizar(['a.jpg'], 'f1')
    await avanzar(5000)
    expect(tercera.pasada).toHaveBeenCalledTimes(1)
  })

  it('si cambiaron las fotos corre aunque no pasaron 30 min', async () => {
    const almacen = almacenFalso()
    const { auto, pasada } = preparar({ almacen: () => almacen })
    auto.actualizar(['a.jpg'], 'f1')
    await avanzar(5000)
    auto.actualizar(['a.jpg', 'b.jpg'], 'f2')
    await avanzar(5000)
    expect(pasada).toHaveBeenCalledTimes(2)
    expect(pasada).toHaveBeenLastCalledWith(['a.jpg', 'b.jpg'], expect.any(AbortSignal))
  })

  it('una pasada incompleta no cuenta: la próxima vez se reintenta', async () => {
    const almacen = almacenFalso()
    const primera = preparar({ almacen: () => almacen, pasada: async () => INCOMPLETA })
    primera.auto.actualizar(['a.jpg'], 'f1')
    await avanzar(5000)
    expect(almacen.datos.has(t.CLAVE_ULTIMA_PASADA)).toBe(false)
    primera.auto.destruir()

    const segunda = preparar({ almacen: () => almacen })
    segunda.auto.actualizar(['a.jpg'], 'f1')
    await avanzar(5000)
    expect(segunda.pasada).toHaveBeenCalledTimes(1)
  })

  it('en segundo plano deja de arrancar fotos y al volver retoma', async () => {
    const d = diferida<ResumenPasada>()
    const { auto, pasada, cambiar, almacen } = preparar({ pasada: () => d.promesa })
    auto.actualizar(['a.jpg', 'b.jpg'], 'f1')
    await avanzar(5000)
    const detener = pasada.mock.calls[0][1]
    expect(detener.aborted).toBe(false)

    cambiar('hidden')
    expect(detener.aborted).toBe(true)
    d.resolver(INCOMPLETA)
    await avanzar(0)
    expect(almacen.datos.has(t.CLAVE_ULTIMA_PASADA)).toBe(false)

    cambiar('visible')
    await avanzar(4999)
    expect(pasada).toHaveBeenCalledTimes(1)
    await avanzar(1)
    expect(pasada).toHaveBeenCalledTimes(2)
  })

  it('oculta antes de arrancar: espera a que vuelva a estar a la vista', async () => {
    const { auto, pasada, cambiar } = preparar()
    auto.actualizar(['a.jpg'], 'f1')
    await avanzar(3000)
    cambiar('hidden')
    await avanzar(60_000)
    expect(pasada).not.toHaveBeenCalled()
    cambiar('visible')
    await avanzar(5000)
    expect(pasada).toHaveBeenCalledTimes(1)
  })

  it('panel abierto en segundo plano: no arranca hasta que se vea', async () => {
    const { auto, pasada, cambiar } = preparar({ visibilidad: 'hidden' })
    auto.actualizar(['a.jpg'], 'f1')
    await avanzar(60_000)
    expect(pasada).not.toHaveBeenCalled()
    cambiar('visible')
    await avanzar(5000)
    expect(pasada).toHaveBeenCalledTimes(1)
  })

  it('si vuelve mientras la pasada detenida todavía termina, retoma después (sin solaparse)', async () => {
    const d = diferida<ResumenPasada>()
    const pasadaLenta = vi.fn<Entorno['pasada']>().mockReturnValueOnce(d.promesa).mockResolvedValue(COMPLETA)
    const { auto, pasada, cambiar } = preparar({ pasada: pasadaLenta })
    auto.actualizar(['a.jpg'], 'f1')
    await avanzar(5000)
    cambiar('hidden')
    cambiar('visible')
    await avanzar(5000)
    expect(pasada).toHaveBeenCalledTimes(1) // la anterior sigue terminando sus fotos

    d.resolver(INCOMPLETA)
    await avanzar(0)
    await avanzar(5000)
    expect(pasada).toHaveBeenCalledTimes(2)
  })

  it('si cambian las fotos durante una pasada, al terminar corre otra con las nuevas', async () => {
    const d = diferida<ResumenPasada>()
    const pasadaLenta = vi.fn<Entorno['pasada']>().mockReturnValueOnce(d.promesa).mockResolvedValue(COMPLETA)
    const { auto, pasada, almacen } = preparar({ pasada: pasadaLenta })
    auto.actualizar(['a.jpg'], 'f1')
    await avanzar(5000)
    auto.actualizar(['a.jpg', 'b.jpg'], 'f2')
    await avanzar(5000)
    expect(pasada).toHaveBeenCalledTimes(1)

    d.resolver(COMPLETA)
    await avanzar(0)
    await avanzar(5000)
    expect(pasada).toHaveBeenCalledTimes(2)
    expect(pasada).toHaveBeenLastCalledWith(['a.jpg', 'b.jpg'], expect.any(AbortSignal))
    expect(JSON.parse(almacen.datos.get(t.CLAVE_ULTIMA_PASADA) ?? '{}')).toMatchObject({ firma: 'f2' })
  })

  it('destruir antes de arrancar: cancela la espera y suelta el oyente', async () => {
    const { auto, pasada, doc, oyentes } = preparar()
    auto.actualizar(['a.jpg'], 'f1')
    await avanzar(3000)
    auto.destruir()
    await avanzar(60_000)
    expect(pasada).not.toHaveBeenCalled()
    expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(oyentes.size).toBe(0)
  })

  it('destruir durante una pasada: la detiene', async () => {
    const d = diferida<ResumenPasada>()
    const { auto, pasada } = preparar({ pasada: () => d.promesa })
    auto.actualizar(['a.jpg'], 'f1')
    await avanzar(5000)
    auto.destruir()
    expect(pasada.mock.calls[0][1].aborted).toBe(true)
    d.resolver(INCOMPLETA)
  })

  it('sin localStorage (tira al acceder) igual corre y no se repite en la misma visita', async () => {
    const { auto, pasada, cambiar } = preparar({
      almacen: () => {
        throw new DOMException('bloqueado', 'SecurityError')
      },
    })
    auto.actualizar(['a.jpg'], 'f1')
    await avanzar(5000)
    expect(pasada).toHaveBeenCalledTimes(1)
    cambiar('hidden')
    cambiar('visible')
    await avanzar(5000)
    expect(pasada).toHaveBeenCalledTimes(1)
  })

  it('una pasada que rechaza no rompe nada ni cuenta como hecha', async () => {
    const falla = vi.fn<Entorno['pasada']>().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(COMPLETA)
    const { auto, pasada, cambiar } = preparar({ pasada: falla })
    auto.actualizar(['a.jpg'], 'f1')
    await avanzar(5000)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Falló'), expect.any(Error))
    cambiar('hidden')
    cambiar('visible')
    await avanzar(5000)
    expect(pasada).toHaveBeenCalledTimes(2)
  })

  // ---- Aviso discreto si viene fallando ----

  it('mientras todo anda no pide aviso', async () => {
    const { auto, avisos, almacen } = preparar()
    await pasadas(auto, ['f1', 'f2', 'f3', 'f4'])
    expect(auto.necesitaAtencion()).toBe(false)
    expect(avisos).not.toHaveBeenCalled()
    expect(almacen.datos.get(t.CLAVE_PASADAS_CON_PROBLEMAS)).toBe('0')
  })

  it('pide aviso recién a la 3.ª pasada seguida con problemas (una sola vez) y queda guardado', async () => {
    const { auto, avisos, almacen } = preparar({ pasada: async () => CON_ERRORES })
    await pasadas(auto, ['f1', 'f2'])
    expect(almacen.datos.get(t.CLAVE_PASADAS_CON_PROBLEMAS)).toBe('2')
    expect(auto.necesitaAtencion()).toBe(false)
    expect(avisos).not.toHaveBeenCalled()

    await pasadas(auto, ['f3'])
    expect(t.PASADAS_CON_PROBLEMAS_PARA_AVISAR).toBe(3)
    expect(auto.necesitaAtencion()).toBe(true)
    expect(avisos).toHaveBeenCalledTimes(1)
    expect(avisos).toHaveBeenCalledWith(true)

    await pasadas(auto, ['f4'])
    expect(avisos).toHaveBeenCalledTimes(1)
    auto.destruir()

    // Otra visita: arranca ya con el aviso, sin esperar otra pasada.
    const otra = preparar({ almacen: () => almacen })
    expect(otra.auto.necesitaAtencion()).toBe(true)
  })

  it('una pasada completa y sin problemas resetea el contador y apaga el aviso', async () => {
    const pasada = vi.fn<Entorno['pasada']>(async () => CON_ERRORES)
    const { auto, avisos, almacen } = preparar({ pasada })
    await pasadas(auto, ['f1', 'f2', 'f3'])
    expect(auto.necesitaAtencion()).toBe(true)

    pasada.mockResolvedValue(COMPLETA)
    await pasadas(auto, ['f4'])
    expect(auto.necesitaAtencion()).toBe(false)
    expect(avisos).toHaveBeenLastCalledWith(false)
    expect(almacen.datos.get(t.CLAVE_PASADAS_CON_PROBLEMAS)).toBe('0')
  })

  it('tienen que ser seguidas: una pasada limpia en el medio vuelve a cero', async () => {
    const pasada = vi
      .fn<Entorno['pasada']>()
      .mockResolvedValueOnce(CON_ERRORES)
      .mockResolvedValueOnce(CON_ERRORES)
      .mockResolvedValueOnce(COMPLETA)
      .mockResolvedValue(CON_ERRORES)
    const { auto, avisos, almacen } = preparar({ pasada })
    await pasadas(auto, ['f1', 'f2', 'f3', 'f4', 'f5'])
    expect(almacen.datos.get(t.CLAVE_PASADAS_CON_PROBLEMAS)).toBe('2')
    expect(auto.necesitaAtencion()).toBe(false)
    expect(avisos).not.toHaveBeenCalled()
  })

  it('una pasada detenida sin errores no suma ni resetea', async () => {
    const pasada = vi
      .fn<Entorno['pasada']>()
      .mockResolvedValueOnce(CON_ERRORES)
      .mockResolvedValueOnce(CON_ERRORES)
      .mockResolvedValueOnce(INCOMPLETA)
      .mockResolvedValue(CON_ERRORES)
    const { auto, almacen } = preparar({ pasada })
    await pasadas(auto, ['f1', 'f2', 'f3'])
    expect(almacen.datos.get(t.CLAVE_PASADAS_CON_PROBLEMAS)).toBe('2')
    await pasadas(auto, ['f4'])
    expect(auto.necesitaAtencion()).toBe(true)
  })

  it('cuentan también: todas "ya existían" (listado roto), sin listado y una pasada que rechaza', async () => {
    const pasada = vi
      .fn<Entorno['pasada']>()
      .mockResolvedValueOnce(TODAS_YA_EXISTIAN)
      .mockResolvedValueOnce(SIN_LISTADO)
      .mockRejectedValueOnce(new Error('boom'))
    const { auto, avisos } = preparar({ pasada })
    await pasadas(auto, ['f1', 'f2', 'f3'])
    expect(pasada).toHaveBeenCalledTimes(3)
    expect(auto.necesitaAtencion()).toBe(true)
    expect(avisos).toHaveBeenCalledWith(true)
  })

  it('sin localStorage el contador sigue en memoria', async () => {
    const { auto, avisos } = preparar({
      pasada: async () => CON_ERRORES,
      almacen: () => {
        throw new DOMException('bloqueado', 'SecurityError')
      },
    })
    await pasadas(auto, ['f1', 'f2', 'f3'])
    expect(auto.necesitaAtencion()).toBe(true)
    expect(avisos).toHaveBeenCalledWith(true)
  })

  it('una pasada que termina después de destruir se cuenta, pero no avisa', async () => {
    const almacen = almacenFalso()
    almacen.datos.set(t.CLAVE_PASADAS_CON_PROBLEMAS, '2')
    const d = diferida<ResumenPasada>()
    const { auto, avisos } = preparar({ almacen: () => almacen, pasada: () => d.promesa })
    await pasadas(auto, ['f1'])
    auto.destruir()
    d.resolver(CON_ERRORES)
    await avanzar(0)
    expect(almacen.datos.get(t.CLAVE_PASADAS_CON_PROBLEMAS)).toBe('3')
    expect(avisos).not.toHaveBeenCalled()
  })
})

describe('pasadaConProblemas', () => {
  const LIMPIA: ResumenPasada = {
    total: 4,
    faltaban: 3,
    generadas: 2,
    yaExistian: 1,
    errores: 0,
    pendientes: 0,
    listada: true,
    completa: true,
  }

  it('sin listado, con errores, o con todas las faltantes "ya existían"', () => {
    expect(t.pasadaConProblemas({ ...LIMPIA, listada: false, faltaban: 0, generadas: 0, yaExistian: 0 })).toBe(true)
    expect(t.pasadaConProblemas({ ...LIMPIA, errores: 1 })).toBe(true)
    expect(t.pasadaConProblemas({ ...LIMPIA, faltaban: 2, generadas: 0, yaExistian: 2 })).toBe(true)
  })

  it('limpia: generadas (alguna ya estaba), nada que hacer, o detenida sin errores', () => {
    expect(t.pasadaConProblemas(LIMPIA)).toBe(false)
    expect(t.pasadaConProblemas({ ...LIMPIA, faltaban: 0, generadas: 0, yaExistian: 0 })).toBe(false)
    expect(t.pasadaConProblemas({ ...LIMPIA, pendientes: 1, completa: false })).toBe(false)
  })
})

describe('esperarReposo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('sin requestIdleCallback: llama pasado el tiempo; cancelado, nunca', async () => {
    const fn = vi.fn()
    t.esperarReposo(fn, 5000)
    await vi.advanceTimersByTimeAsync(4999)
    expect(fn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fn).toHaveBeenCalledTimes(1)

    const cancelada = vi.fn()
    const cancelar = t.esperarReposo(cancelada, 5000)
    await vi.advanceTimersByTimeAsync(1000)
    cancelar()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(cancelada).not.toHaveBeenCalled()
  })

  it('con requestIdleCallback: espera el tiempo y después a que el navegador esté ocioso', async () => {
    const requestIdleCallback = vi.fn((_cb: () => void, _opciones?: IdleRequestOptions) => 7)
    const cancelIdleCallback = vi.fn()
    vi.stubGlobal('requestIdleCallback', requestIdleCallback)
    vi.stubGlobal('cancelIdleCallback', cancelIdleCallback)

    const fn = vi.fn()
    t.esperarReposo(fn, 5000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 5000 })
    expect(fn).not.toHaveBeenCalled()
    const [ocioso] = requestIdleCallback.mock.calls[0]
    ocioso()
    expect(fn).toHaveBeenCalledTimes(1)

    const cancelar = t.esperarReposo(vi.fn(), 5000)
    await vi.advanceTimersByTimeAsync(5000)
    cancelar()
    expect(cancelIdleCallback).toHaveBeenCalledWith(7)
  })
})
