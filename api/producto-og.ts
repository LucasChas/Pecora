import {
  consultaDeParam,
  htmlDeRespaldo,
  inyectarMeta,
  metaGenerica,
  metaProducto,
  urlDelSitio,
  type MetaOg,
  type ProductoOg,
} from '../src/lib/ogProducto.js'

// ============================================================================
// Vercel Function (runtime Node.js, firma Web estándar Request/Response).
//
// vercel.json manda acá /producto/:param SOLO cuando quien pide es un bot de
// vista previa (WhatsApp, Facebook/Instagram, X, Telegram, etc.), que no
// ejecuta JavaScript. Devuelve el mismo index.html del deploy con las meta del
// producto (título, descripción + precio, foto, URL canónica). Las personas
// siguen recibiendo la SPA estática de siempre, sin pasar por acá.
//
// Nunca contesta 500: si falta configuración, el producto no existe o Supabase
// tarda/falla, sale index.html con la vista previa genérica.
//
// Variables de entorno (las mismas del build de Vite; en Vercel también están
// disponibles en tiempo de ejecución para las funciones):
// - VITE_APP_MODE: solo 'catalog' inyecta meta de producto. El deploy del panel
//   ('admin') recibe su index.html sin tocar (con su noindex).
// - VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY: lectura pública de productos
//   (RLS "productos lectura publica", migración 0001).
// - VITE_CATALOG_URL: dominio público para og:url / og:image.
// ============================================================================


// Sin @types/node en el repo: alcanza con declarar lo que se usa.
declare const process: { env: Record<string, string | undefined> }

// Tope de la consulta a Supabase: un bot espera unos segundos como mucho, y
// es preferible la vista previa genérica a quedarse sin ninguna.
const TOPE_SUPABASE_MS = 2500
const TOPE_INDEX_MS = 3000

// Caché en el CDN de Vercel: 10 minutos fresca y hasta 1 día sirviendo la
// anterior mientras se regenera en segundo plano. Un cambio de nombre, precio
// o foto se ve en la vista previa a lo sumo ~10 minutos después (y además cada
// app guarda su propia copia).
export const CACHE_OK = 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400'
// Genérica por error o producto inexistente: caché corta, para reintentar pronto.
export const CACHE_GENERICA = 'public, max-age=0, s-maxage=60, stale-while-revalidate=600'

const COLUMNAS = 'id,slug,nombre,descripcion,precio,imagen_url,imagenes,stock'

// Dependencias externas del handler. Se inyectan para poder probar cada rama
// (tests en api/_tests/, que Vercel no publica como función por el guion bajo).
export interface DependenciasOg {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  // Se lee en cada pedido: debe reflejar el entorno vigente.
  env: () => Record<string, string | undefined>
  log: (...datos: unknown[]) => void
  topeIndexMs?: number
  topeSupabaseMs?: number
}

export interface HandlerOg {
  GET: (request: Request) => Promise<Response>
  HEAD: (request: Request) => Promise<Response>
}

// Crea el handler con sus dependencias. Cada instancia guarda su propia copia
// de index.html en memoria.
export function crearHandlerOg(deps: DependenciasOg): HandlerOg {
  const topeIndexMs = deps.topeIndexMs ?? TOPE_INDEX_MS
  const topeSupabaseMs = deps.topeSupabaseMs ?? TOPE_SUPABASE_MS

  // index.html no cambia dentro de un mismo deploy (cada deploy tiene sus
  // propias instancias): se guarda en memoria mientras la instancia siga viva.
  let indexEnMemoria: string | null = null

  async function GET(request: Request): Promise<Response> {
    const env = deps.env()
    const url = new URL(request.url)
    const sitio = urlDelSitio(env.VITE_CATALOG_URL)
    const html = await obtenerIndex(url.origin)

    // Deploy del panel (o sin modo): el index.html del deploy tal cual.
    if (env.VITE_APP_MODE !== 'catalog') {
      return responder(html ?? htmlDeRespaldo(metaGenerica(sitio)), CACHE_GENERICA, true)
    }

    const producto = await buscarProducto(url.searchParams.get('param'), env)
    const meta: MetaOg = metaProducto(producto, sitio)
    const cache = producto ? CACHE_OK : CACHE_GENERICA

    if (html === null) return responder(htmlDeRespaldo(meta), 'no-store', false)
    return responder(inyectarMeta(html, meta), cache, false)
  }

  // HEAD lo usan algunos bots para chequear el link antes de pedirlo.
  async function HEAD(request: Request): Promise<Response> {
    const respuesta = await GET(request)
    return new Response(null, { status: respuesta.status, headers: respuesta.headers })
  }

  // index.html ya construido de ESTE deploy (con los assets con hash de Vite y
  // __SITE_URL__ completado). Es un archivo estático: el pedido lo resuelve el
  // CDN sin volver a pasar por esta función. null si no se pudo obtener (por
  // ejemplo, un deploy de preview con Deployment Protection).
  async function obtenerIndex(origen: string): Promise<string | null> {
    if (indexEnMemoria !== null) return indexEnMemoria
    try {
      const respuesta = await deps.fetch(`${origen}/index.html`, {
        signal: AbortSignal.timeout(topeIndexMs),
        headers: { accept: 'text/html' },
      })
      if (!respuesta.ok) {
        deps.log(
          `[producto-og] index.html respondió HTTP ${respuesta.status}; se usa la página de respaldo. ` +
            '¿El deploy tiene Deployment Protection activa?',
        )
        return null
      }
      const html = await respuesta.text()
      if (!/<\/head>/i.test(html)) {
        deps.log('[producto-og] index.html no tiene </head>; se usa la página de respaldo.')
        return null
      }
      indexEnMemoria = html
      return html
    } catch (e) {
      deps.log('[producto-og] No se pudo obtener index.html:', e)
      return null
    }
  }

  // Producto por slug o id vía la API REST de Supabase con la clave anon.
  // null si el parámetro no puede ser un producto, no existe, falta la
  // configuración, Supabase contesta con error o tarda más que el tope.
  async function buscarProducto(
    param: string | null,
    env: Record<string, string | undefined>,
  ): Promise<ProductoOg | null> {
    // Un parámetro inválido es tráfico normal (links rotos, bots): sin log.
    const consulta = consultaDeParam(param)
    if (!consulta) return null

    const base = (env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
    const clave = (env.VITE_SUPABASE_ANON_KEY ?? '').trim()
    if (!/^https:\/\//i.test(base)) {
      deps.log(
        '[producto-og] Configuración de Supabase inválida: VITE_SUPABASE_URL falta o no empieza con https://.',
      )
      return null
    }
    if (!clave) {
      // Nunca se registra el valor de la clave.
      deps.log('[producto-og] Configuración de Supabase inválida: falta VITE_SUPABASE_ANON_KEY.')
      return null
    }

    const filtro = `${consulta.columna}=eq.${encodeURIComponent(consulta.valor)}`
    try {
      const respuesta = await deps.fetch(`${base}/rest/v1/productos?select=${COLUMNAS}&${filtro}&limit=1`, {
        signal: AbortSignal.timeout(topeSupabaseMs),
        headers: { apikey: clave, authorization: `Bearer ${clave}`, accept: 'application/json' },
      })
      if (!respuesta.ok) {
        deps.log(`[producto-og] Supabase respondió HTTP ${respuesta.status}.`)
        return null
      }
      const filas: unknown = await respuesta.json()
      if (!Array.isArray(filas) || filas.length === 0) return null
      const fila = filas[0] as ProductoOg
      return typeof fila === 'object' && fila !== null && typeof fila.id === 'string' ? fila : null
    } catch (e) {
      deps.log('[producto-og] No se pudo consultar el producto:', e)
      return null
    }
  }

  return { GET, HEAD }
}

function responder(html: string, cache: string, noindex: boolean): Response {
  const headers: Record<string, string> = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': cache,
  }
  if (noindex) headers['x-robots-tag'] = 'noindex, nofollow'
  return new Response(html, { status: 200, headers })
}

// Instancia real: fetch global, variables de entorno del proceso y console.warn.
const handler = crearHandlerOg({
  fetch: (url, init) => fetch(url, init),
  env: () => process.env,
  log: (...datos) => console.warn(...datos),
})

// Puntos de entrada de Vercel.
export async function GET(request: Request): Promise<Response> {
  return handler.GET(request)
}

export async function HEAD(request: Request): Promise<Response> {
  return handler.HEAD(request)
}
