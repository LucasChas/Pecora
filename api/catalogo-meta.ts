import { imagenProducto, normalizarEspacios, truncar, urlDelSitio } from '../src/lib/ogProducto.js'

// ============================================================================
// Vercel Function: /catalogo-meta.csv (vercel.json lo reescribe acá).
//
// Feed de productos para el catálogo de Meta (Instagram Shopping y Facebook):
// en el Administrador de comercio se carga esta URL como "feed de datos
// programado" y Meta la lee sola cada día. Con el catálogo conectado se pueden
// etiquetar productos en publicaciones e historias de Instagram.
//
// Una fila por producto. Un producto con talles va como un "grupo"
// (item_group_id) con una fila por talle, cada una con su stock.
// Columnas: https://www.facebook.com/business/help/120325381656392
//
// En el deploy del panel contesta 404.
// ============================================================================

declare const process: { env: Record<string, string | undefined> }

const TOPE_SUPABASE_MS = 6000
export const CACHE_FEED = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400'
export const MARCA = 'Pecora'

export interface DependenciasFeed {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  env: () => Record<string, string | undefined>
  log: (...datos: unknown[]) => void
}

export interface FilaProductoFeed {
  id: string
  slug: string | null
  nombre: string | null
  descripcion: string | null
  precio: number | string | null
  stock: number | null
  imagen_url: string | null
  imagenes?: string[] | null
  categorias?: { nombre: string | null } | null
  producto_talles?: { id: string; talle: string; stock: number; orden?: number | null }[] | null
}

export const COLUMNAS = [
  'id',
  'item_group_id',
  'title',
  'description',
  'availability',
  'condition',
  'price',
  'link',
  'image_link',
  'additional_image_link',
  'brand',
  'product_type',
  'size',
  'inventory',
] as const

type Fila = Record<(typeof COLUMNAS)[number], string>

/** Celda CSV: entre comillas si hace falta, sin saltos de línea. */
export function celda(valor: string): string {
  const limpio = valor.replace(/[\r\n]+/g, ' ')
  return /[",]/.test(limpio) || /^\s|\s$/.test(limpio) ? `"${limpio.replace(/"/g, '""')}"` : limpio
}

export function precioMeta(precio: FilaProductoFeed['precio']): string | null {
  const n = typeof precio === 'string' ? Number(precio) : precio
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null
  return `${n.toFixed(2)} ARS`
}

/** Filas del feed para un producto (una, o una por talle). [] si no sirve. */
export function filasDeProducto(p: FilaProductoFeed, sitio: string): Fila[] {
  const nombre = normalizarEspacios(p.nombre ?? '')
  const precio = precioMeta(p.precio)
  const imagen = imagenProducto({ imagenes: p.imagenes ?? null, imagen_url: p.imagen_url }, sitio)
  // Meta rechaza filas sin título, precio o imagen: mejor no mandarlas.
  if (!nombre || !precio || !imagen) return []

  const link = `${sitio}/producto/${encodeURIComponent(p.slug || p.id)}`
  const extras = (p.imagenes ?? [])
    .map((u) => imagenProducto({ imagenes: [u], imagen_url: null }, sitio))
    .filter((u): u is string => !!u && u !== imagen)
    .slice(0, 10)
  const base = {
    title: truncar(nombre, 150),
    description: truncar(normalizarEspacios(p.descripcion ?? '') || `${nombre} · Accesorios textiles para bebés.`, 5000),
    condition: 'new',
    price: precio,
    link,
    image_link: imagen,
    additional_image_link: extras.join(','),
    brand: MARCA,
    product_type: normalizarEspacios(p.categorias?.nombre ?? ''),
  }

  const talles = [...(p.producto_talles ?? [])].sort(
    (a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.talle.localeCompare(b.talle, 'es', { numeric: true }),
  )
  if (talles.length === 0) {
    const stock = Math.max(0, Math.floor(Number(p.stock) || 0))
    return [
      {
        ...base,
        id: p.id,
        item_group_id: '',
        availability: stock > 0 ? 'in stock' : 'out of stock',
        size: '',
        inventory: String(stock),
      },
    ]
  }
  return talles.map((t) => {
    const stock = Math.max(0, Math.floor(Number(t.stock) || 0))
    return {
      ...base,
      id: `${p.id}-${t.id}`,
      item_group_id: p.id,
      availability: stock > 0 ? 'in stock' : 'out of stock',
      size: t.talle,
      inventory: String(stock),
    }
  })
}

export function csvFeed(filas: readonly Fila[]): string {
  const lineas = [COLUMNAS.join(',')]
  for (const f of filas) lineas.push(COLUMNAS.map((c) => celda(f[c] ?? '')).join(','))
  return lineas.join('\n') + '\n'
}

export function crearHandlerFeed(deps: DependenciasFeed) {
  async function leer(env: Record<string, string | undefined>): Promise<FilaProductoFeed[] | null> {
    const base = (env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
    const clave = (env.VITE_SUPABASE_ANON_KEY ?? '').trim()
    if (!/^https:\/\//i.test(base) || !clave) {
      deps.log('[catalogo-meta] Falta la configuración de Supabase.')
      return null
    }
    const pedir = (select: string) =>
      deps.fetch(`${base}/rest/v1/productos?select=${encodeURIComponent(select)}&order=created_at.desc&limit=2000`, {
        signal: AbortSignal.timeout(TOPE_SUPABASE_MS),
        headers: { apikey: clave, authorization: `Bearer ${clave}`, accept: 'application/json' },
      })
    try {
      const columnas = 'id,slug,nombre,descripcion,precio,stock,imagen_url,imagenes,categorias(nombre)'
      let r = await pedir(`${columnas},producto_talles(id,talle,stock,orden)`)
      // Sin la migración de talles, la relación no existe: sin talles.
      if (r.status === 400) r = await pedir(columnas)
      if (!r.ok) {
        deps.log(`[catalogo-meta] Supabase respondió HTTP ${r.status}.`)
        return null
      }
      const filas: unknown = await r.json()
      return Array.isArray(filas) ? (filas as FilaProductoFeed[]) : null
    } catch (e) {
      deps.log('[catalogo-meta] No se pudieron leer los productos:', e)
      return null
    }
  }

  async function GET(): Promise<Response> {
    const env = deps.env()
    if (env.VITE_APP_MODE === 'admin') {
      return new Response('Not found', { status: 404, headers: { 'x-robots-tag': 'noindex, nofollow' } })
    }
    const productos = await leer(env)
    // Si falla, error (no un feed vacío): Meta interpretaría que no hay
    // productos y los daría de baja del catálogo.
    if (!productos) {
      return new Response('No se pudo armar el catálogo. Probá de nuevo en un rato.', {
        status: 503,
        headers: { 'cache-control': 'no-store', 'retry-after': '600' },
      })
    }
    const sitio = urlDelSitio(env.VITE_CATALOG_URL)
    const filas = productos.flatMap((p) => filasDeProducto(p, sitio))
    return new Response(csvFeed(filas), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'cache-control': CACHE_FEED,
        'x-robots-tag': 'noindex',
      },
    })
  }

  return { GET }
}

const handler = crearHandlerFeed({
  fetch: (url, init) => fetch(url, init),
  env: () => process.env,
  log: (...datos) => console.warn(...datos),
})

export async function GET(): Promise<Response> {
  return handler.GET()
}
