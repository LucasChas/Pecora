import { describe, expect, it } from 'vitest'
import { crearHandlerSitemap, entradasSitemap, fechaW3c, xmlSitemap } from '../sitemap.js'

const SITIO = 'https://pecora.test'
const ENV = {
  VITE_APP_MODE: 'catalog',
  VITE_SUPABASE_URL: 'https://abc.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'clave',
  VITE_CATALOG_URL: SITIO,
}

function crear(respuesta: Response | Error, env: Record<string, string | undefined> = ENV) {
  const llamadas: string[] = []
  const logs: unknown[][] = []
  const handler = crearHandlerSitemap({
    fetch: async (url) => {
      llamadas.push(url)
      if (respuesta instanceof Error) throw respuesta
      return respuesta
    },
    env: () => env,
    log: (...d) => logs.push(d),
  })
  return { handler, llamadas, logs }
}

describe('sitemap', () => {
  it('fechaW3c', () => {
    expect(fechaW3c('2026-09-30T12:00:00Z')).toBe('2026-09-30')
    expect(fechaW3c('x')).toBeUndefined()
    expect(fechaW3c(null)).toBeUndefined()
  })

  it('arma páginas fijas y fichas por slug (o id), sin repetir', () => {
    const e = entradasSitemap(SITIO, [
      { id: 'a', slug: 'babero', updated_at: '2026-09-30T00:00:00Z' },
      { id: 'b', slug: null, updated_at: null },
      { id: 'c', slug: 'babero', updated_at: null },
    ])
    expect(e.map((x) => x.loc)).toEqual([
      `${SITIO}/`,
      `${SITIO}/privacidad`,
      `${SITIO}/terminos`,
      `${SITIO}/producto/babero`,
      `${SITIO}/producto/b`,
    ])
    expect(e[3].lastmod).toBe('2026-09-30')
  })

  it('el XML escapa las URLs', () => {
    const xml = xmlSitemap([{ loc: `${SITIO}/x?a=1&b=2`, prioridad: '0.5' }])
    expect(xml).toContain('<loc>https://pecora.test/x?a=1&amp;b=2</loc>')
    expect(xml.startsWith('<?xml')).toBe(true)
  })

  it('GET lista los productos de Supabase', async () => {
    const { handler, llamadas } = crear(
      new Response(JSON.stringify([{ id: '1', slug: 'manta', updated_at: '2026-01-02T00:00:00Z' }])),
    )
    const r = await handler.GET()
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('xml')
    const xml = await r.text()
    expect(xml).toContain(`${SITIO}/producto/manta`)
    expect(llamadas[0]).toContain('/rest/v1/productos?select=id,slug,updated_at')
  })

  it('si Supabase falla, sale igual con las páginas fijas', async () => {
    const { handler, logs } = crear(new Error('red'))
    const r = await handler.GET()
    expect(r.status).toBe(200)
    const xml = await r.text()
    expect(xml).toContain(`<loc>${SITIO}/</loc>`)
    expect(xml).not.toContain('/producto/')
    expect(logs.length).toBe(1)
  })

  it('en el deploy del panel contesta 404', async () => {
    const { handler, llamadas } = crear(new Response('[]'), { ...ENV, VITE_APP_MODE: 'admin' })
    expect((await handler.GET()).status).toBe(404)
    expect(llamadas).toHaveLength(0)
  })
})
