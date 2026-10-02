import { urlDelSitio } from '../src/lib/ogProducto.js'

// ============================================================================
// Vercel Function: /sitemap.xml (vercel.json lo reescribe acá).
//
// Lista para los buscadores la portada, las páginas legales y la ficha de cada
// producto (por slug, con su fecha de última modificación). Se arma en cada
// pedido con la API pública de Supabase (clave anon, misma lectura que el
// catálogo) y queda una hora en la caché del CDN.
//
// Nunca contesta 500: si Supabase falla, sale el sitemap con las páginas fijas.
// En el deploy del panel (VITE_APP_MODE=admin) contesta 404: el panel no se
// indexa.
// ============================================================================

declare const process: { env: Record<string, string | undefined> }

const TOPE_SUPABASE_MS = 4000
export const CACHE_SITEMAP = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400'

export interface DependenciasSitemap {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  env: () => Record<string, string | undefined>
  log: (...datos: unknown[]) => void
}

interface FilaProducto {
  id: string
  slug: string | null
  updated_at: string | null
}

export interface EntradaSitemap {
  loc: string
  lastmod?: string
  prioridad: string
}

function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Fecha W3C (YYYY-MM-DD) o undefined si no es una fecha válida. */
export function fechaW3c(valor: string | null | undefined): string | undefined {
  if (!valor) return undefined
  const fecha = new Date(valor)
  return Number.isNaN(fecha.getTime()) ? undefined : fecha.toISOString().slice(0, 10)
}

export function entradasSitemap(sitio: string, productos: readonly FilaProducto[]): EntradaSitemap[] {
  const fijas: EntradaSitemap[] = [
    { loc: `${sitio}/`, prioridad: '1.0' },
    { loc: `${sitio}/privacidad`, prioridad: '0.2' },
    { loc: `${sitio}/terminos`, prioridad: '0.2' },
  ]
  const vistos = new Set<string>()
  const fichas: EntradaSitemap[] = []
  for (const p of productos) {
    if (!p || typeof p.id !== 'string') continue
    const param = p.slug?.trim() || p.id
    const loc = `${sitio}/producto/${encodeURIComponent(param)}`
    if (vistos.has(loc)) continue
    vistos.add(loc)
    fichas.push({ loc, lastmod: fechaW3c(p.updated_at), prioridad: '0.8' })
  }
  return [...fijas, ...fichas]
}

export function xmlSitemap(entradas: readonly EntradaSitemap[]): string {
  const urls = entradas.map((e) =>
    [
      '  <url>',
      `    <loc>${escaparXml(e.loc)}</loc>`,
      ...(e.lastmod ? [`    <lastmod>${e.lastmod}</lastmod>`] : []),
      `    <priority>${e.prioridad}</priority>`,
      '  </url>',
    ].join('\n'),
  )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}

export function crearHandlerSitemap(deps: DependenciasSitemap) {
  async function leerProductos(env: Record<string, string | undefined>): Promise<FilaProducto[]> {
    const base = (env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
    const clave = (env.VITE_SUPABASE_ANON_KEY ?? '').trim()
    if (!/^https:\/\//i.test(base) || !clave) {
      deps.log('[sitemap] Falta la configuración de Supabase; solo se listan las páginas fijas.')
      return []
    }
    try {
      const r = await deps.fetch(
        `${base}/rest/v1/productos?select=id,slug,updated_at&order=updated_at.desc&limit=5000`,
        {
          signal: AbortSignal.timeout(TOPE_SUPABASE_MS),
          headers: { apikey: clave, authorization: `Bearer ${clave}`, accept: 'application/json' },
        },
      )
      if (!r.ok) {
        deps.log(`[sitemap] Supabase respondió HTTP ${r.status}.`)
        return []
      }
      const filas: unknown = await r.json()
      return Array.isArray(filas) ? (filas as FilaProducto[]) : []
    } catch (e) {
      deps.log('[sitemap] No se pudieron leer los productos:', e)
      return []
    }
  }

  async function GET(): Promise<Response> {
    const env = deps.env()
    if (env.VITE_APP_MODE === 'admin') {
      return new Response('Not found', { status: 404, headers: { 'x-robots-tag': 'noindex, nofollow' } })
    }
    const sitio = urlDelSitio(env.VITE_CATALOG_URL)
    const productos = await leerProductos(env)
    return new Response(xmlSitemap(entradasSitemap(sitio, productos)), {
      status: 200,
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': productos.length ? CACHE_SITEMAP : 'public, max-age=0, s-maxage=300',
      },
    })
  }

  return { GET }
}

const handler = crearHandlerSitemap({
  fetch: (url, init) => fetch(url, init),
  env: () => process.env,
  log: (...datos) => console.warn(...datos),
})

export async function GET(): Promise<Response> {
  return handler.GET()
}
