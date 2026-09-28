import { describe, expect, it } from 'vitest'
import { CACHE_GENERICA, CACHE_OK, crearHandlerOg, type DependenciasOg } from '../producto-og.js'

// Tests del handler de vista previa con dependencias falsas (fetch, entorno y
// log). La carpeta lleva guion bajo para que Vercel no la publique como función.

const ORIGEN = 'https://pecora-muestrario.vercel.app'
const INDEX =
  '<!DOCTYPE html><html><head><title>Pecora</title><meta property="og:title" content="Genérico" /></head><body><div id="root"></div></body></html>'
const PRODUCTO = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'babero-ositos',
  nombre: 'Babero Ositos',
  descripcion: 'Algodón',
  precio: 1500,
  imagen_url: null,
  imagenes: [],
}
const ENV_CATALOGO: Record<string, string | undefined> = {
  VITE_APP_MODE: 'catalog',
  VITE_SUPABASE_URL: 'https://abc.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'clave-anon-secreta',
  VITE_CATALOG_URL: ORIGEN,
}

// 'cuelga' simula un servidor que no contesta: espera hasta que se aborte la señal.
type Respuesta = Response | Error | 'cuelga'

interface Llamada {
  url: string
  init: RequestInit
}

const html = (cuerpo: string, status = 200) => new Response(cuerpo, { status })
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status })
const pedido = (param = 'babero-ositos', metodo = 'GET') =>
  new Request(`${ORIGEN}/api/producto-og?param=${encodeURIComponent(param)}`, { method: metodo })
const textoLogs = (logs: unknown[][]) => logs.map((l) => l.map(String).join(' ')).join('\n')

function crear(opciones: {
  env?: Record<string, string | undefined>
  index?: () => Respuesta
  supabase?: () => Respuesta
}) {
  const llamadas: Llamada[] = []
  const logs: unknown[][] = []
  const resolver = (r: Respuesta, init: RequestInit): Promise<Response> => {
    if (r instanceof Error) return Promise.reject(r)
    if (r === 'cuelga') {
      return new Promise((_, rechazar) => {
        init.signal?.addEventListener('abort', () => rechazar(init.signal?.reason))
      })
    }
    return Promise.resolve(r)
  }
  const deps: DependenciasOg = {
    fetch: (url, init) => {
      llamadas.push({ url, init })
      if (url.endsWith('/index.html')) return resolver((opciones.index ?? (() => html(INDEX)))(), init)
      return resolver((opciones.supabase ?? (() => json([PRODUCTO])))(), init)
    },
    env: () => opciones.env ?? ENV_CATALOGO,
    log: (...datos) => logs.push(datos),
    topeIndexMs: 20,
    topeSupabaseMs: 20,
  }
  return { handler: crearHandlerOg(deps), llamadas, logs }
}

describe('producto-og: deploy que no es el catálogo', () => {
  it('devuelve index.html sin tocar, con noindex y caché genérica, sin consultar Supabase', async () => {
    const { handler, llamadas } = crear({ env: { ...ENV_CATALOGO, VITE_APP_MODE: 'admin' } })
    const r = await handler.GET(pedido())
    expect(r.status).toBe(200)
    expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(r.headers.get('cache-control')).toBe(CACHE_GENERICA)
    expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await r.text()).toBe(INDEX)
    expect(llamadas.map((l) => l.url)).toEqual([`${ORIGEN}/index.html`])
  })

  it('sin modo y sin index.html: página de respaldo genérica con noindex', async () => {
    const { handler } = crear({ env: {}, index: () => html('', 404) })
    const r = await handler.GET(pedido())
    expect(r.status).toBe(200)
    expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(r.headers.get('cache-control')).toBe(CACHE_GENERICA)
    expect(await r.text()).toContain('<!DOCTYPE html>')
  })
})

describe('producto-og: catálogo con producto', () => {
  it('inyecta las meta del producto con CACHE_OK y sin noindex', async () => {
    const { handler, llamadas, logs } = crear({})
    const r = await handler.GET(pedido())
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe(CACHE_OK)
    expect(r.headers.get('x-robots-tag')).toBeNull()
    const cuerpo = await r.text()
    expect(cuerpo).toContain('Babero Ositos')
    expect(cuerpo).not.toContain('content="Genérico"')
    expect(cuerpo).toContain('<div id="root"></div>')
    const consulta = llamadas[1]
    expect(consulta.url).toContain('https://abc.supabase.co/rest/v1/productos?select=')
    expect(consulta.url).toContain('slug=eq.babero-ositos')
    expect((consulta.init.headers as Record<string, string>).apikey).toBe('clave-anon-secreta')
    expect(logs).toEqual([])
  })

  it('guarda index.html en memoria: el segundo pedido no lo vuelve a buscar', async () => {
    const { handler, llamadas } = crear({})
    await handler.GET(pedido())
    await handler.GET(pedido())
    expect(llamadas.filter((l) => l.url.endsWith('/index.html'))).toHaveLength(1)
  })

  it('HEAD: mismo status y headers, sin cuerpo', async () => {
    const { handler } = crear({})
    const r = await handler.HEAD(pedido('babero-ositos', 'HEAD'))
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe(CACHE_OK)
    expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(r.body).toBeNull()
  })
})

describe('producto-og: fallas al obtener index.html', () => {
  it('HTTP no OK: respaldo con meta del producto, no-store y log con el status y la pista', async () => {
    const { handler, logs } = crear({ index: () => html('', 401) })
    const r = await handler.GET(pedido())
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('x-robots-tag')).toBeNull()
    const cuerpo = await r.text()
    expect(cuerpo).toContain('<!DOCTYPE html>')
    expect(cuerpo).toContain('Babero Ositos')
    expect(textoLogs(logs)).toContain('[producto-og] index.html respondió HTTP 401')
    expect(textoLogs(logs)).toContain('Deployment Protection')
  })

  it('error de red: respaldo no-store y log', async () => {
    const { handler, logs } = crear({ index: () => new TypeError('fetch failed') })
    const r = await handler.GET(pedido())
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(textoLogs(logs)).toContain('[producto-og] No se pudo obtener index.html:')
  })

  it('tope de tiempo: aborta, respaldo no-store y log', async () => {
    const { handler, logs, llamadas } = crear({ index: () => 'cuelga' })
    const r = await handler.GET(pedido())
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(llamadas[0].init.signal?.aborted).toBe(true)
    expect(textoLogs(logs)).toContain('[producto-og] No se pudo obtener index.html:')
  })

  it('HTML sin </head>: respaldo no-store, log y no se guarda en memoria', async () => {
    let n = 0
    const { handler, logs, llamadas } = crear({ index: () => (n++ === 0 ? html('<html>roto') : html(INDEX)) })
    const r = await handler.GET(pedido())
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(textoLogs(logs)).toContain('[producto-og] index.html no tiene </head>')
    const r2 = await handler.GET(pedido())
    expect(r2.headers.get('cache-control')).toBe(CACHE_OK)
    expect(llamadas.filter((l) => l.url.endsWith('/index.html'))).toHaveLength(2)
  })
})

describe('producto-og: fallas al buscar el producto', () => {
  const esperarGenerica = async (r: Response) => {
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe(CACHE_GENERICA)
    expect(r.headers.get('x-robots-tag')).toBeNull()
    const cuerpo = await r.text()
    expect(cuerpo).not.toContain('Babero Ositos')
    expect(cuerpo).toContain('<div id="root"></div>')
  }

  it('parámetro inválido: genérica, sin consultar Supabase y sin log', async () => {
    const { handler, llamadas, logs } = crear({})
    await esperarGenerica(await handler.GET(pedido('<script>')))
    expect(llamadas).toHaveLength(1)
    expect(logs).toEqual([])
  })

  it('falta VITE_SUPABASE_URL: genérica y log que nombra la variable', async () => {
    const { handler, llamadas, logs } = crear({ env: { ...ENV_CATALOGO, VITE_SUPABASE_URL: undefined } })
    await esperarGenerica(await handler.GET(pedido()))
    expect(llamadas).toHaveLength(1)
    expect(textoLogs(logs)).toContain('[producto-og] Configuración de Supabase inválida: VITE_SUPABASE_URL')
  })

  it('VITE_SUPABASE_URL sin https: genérica y log', async () => {
    const { handler, logs } = crear({ env: { ...ENV_CATALOGO, VITE_SUPABASE_URL: 'http://abc.supabase.co' } })
    await esperarGenerica(await handler.GET(pedido()))
    expect(textoLogs(logs)).toContain('[producto-og] Configuración de Supabase inválida: VITE_SUPABASE_URL')
  })

  it('falta VITE_SUPABASE_ANON_KEY: genérica y log que nombra la variable', async () => {
    const { handler, llamadas, logs } = crear({ env: { ...ENV_CATALOGO, VITE_SUPABASE_ANON_KEY: '   ' } })
    await esperarGenerica(await handler.GET(pedido()))
    expect(llamadas).toHaveLength(1)
    expect(textoLogs(logs)).toContain(
      '[producto-og] Configuración de Supabase inválida: falta VITE_SUPABASE_ANON_KEY',
    )
  })

  it('Supabase HTTP no OK: genérica, log con el status y sin la clave', async () => {
    const { handler, logs } = crear({ supabase: () => json({ message: 'error' }, 503) })
    await esperarGenerica(await handler.GET(pedido()))
    expect(textoLogs(logs)).toContain('[producto-og] Supabase respondió HTTP 503.')
    expect(textoLogs(logs)).not.toContain('clave-anon-secreta')
  })

  it('sin filas: genérica sin log', async () => {
    const { handler, logs } = crear({ supabase: () => json([]) })
    await esperarGenerica(await handler.GET(pedido()))
    expect(logs).toEqual([])
  })

  it('respuesta que no es un arreglo: genérica', async () => {
    const { handler } = crear({ supabase: () => json({ id: PRODUCTO.id }) })
    await esperarGenerica(await handler.GET(pedido()))
  })

  it('fila sin id de texto: genérica', async () => {
    const { handler } = crear({ supabase: () => json([{ ...PRODUCTO, id: 7 }]) })
    await esperarGenerica(await handler.GET(pedido()))
  })

  it('fila null: genérica', async () => {
    const { handler } = crear({ supabase: () => json([null]) })
    await esperarGenerica(await handler.GET(pedido()))
  })

  it('JSON inválido: genérica y log', async () => {
    const { handler, logs } = crear({ supabase: () => html('no es json') })
    await esperarGenerica(await handler.GET(pedido()))
    expect(textoLogs(logs)).toContain('[producto-og] No se pudo consultar el producto:')
  })

  it('tope de tiempo: aborta la consulta, genérica y log', async () => {
    const { handler, logs, llamadas } = crear({ supabase: () => 'cuelga' })
    await esperarGenerica(await handler.GET(pedido()))
    expect(llamadas[1].init.signal?.aborted).toBe(true)
    expect(textoLogs(logs)).toContain('[producto-og] No se pudo consultar el producto:')
  })
})
