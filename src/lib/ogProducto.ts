import { money } from './format.js'

// ============================================================================
// Vista previa (Open Graph) de la ficha de un producto.
//
// WhatsApp, Instagram, Facebook, X, etc. leen las meta del HTML sin ejecutar
// JavaScript, así que la SPA sola siempre muestra la vista previa genérica del
// muestrario. La función de Vercel api/producto-og.ts toma el index.html ya
// construido y le cambia las meta por las del producto usando este módulo.
//
// Lógica pura, sin React, sin Vite (import.meta.env) ni APIs del navegador:
// corre igual en Node (la función de Vercel) y en los tests. Por eso el import
// de arriba lleva la extensión ".js" (Node ESM la exige; TypeScript la resuelve
// al .ts).
// ============================================================================

// Dominio de producción del muestrario (mismo valor por defecto que
// vite.config.ts y src/lib/config.ts).
export const SITIO_POR_DEFECTO = 'https://pecora-muestrario.vercel.app'

export const TITULO_GENERICO = 'Pecora · Accesorios textiles para bebés'
export const DESCRIPCION_GENERICA =
  'Baberos, babitas, mantas y accesorios de algodón hechos a mano. Mirá el muestrario y hacé tu pedido.'

// Largos máximos. Las apps cortan solas, pero un texto enorme (una descripción
// larguísima) engorda el HTML y se ve mal en la tarjeta.
export const MAX_TITULO = 90
export const MAX_DESCRIPCION = 160

// Columnas del producto que hacen falta para la vista previa (compatible con
// Producto de src/types.ts, sin depender de él).
export interface ProductoOg {
  id: string
  slug: string | null
  nombre: string | null
  descripcion: string | null
  precio: number | string | null
  imagen_url: string | null
  imagenes?: string[] | null
}

// Una meta: <meta property="og:..."> o <meta name="...">.
export interface MetaTag {
  atributo: 'property' | 'name'
  clave: string
  valor: string
}

// Todo lo que se inyecta en el <head>.
export interface MetaOg {
  titulo: string // <title>
  canonica: string // <link rel="canonical">
  tags: MetaTag[]
}

// ---- Utilidades -----------------------------------------------------------------

// Escapa texto para usarlo dentro de un atributo o de un nodo de texto HTML.
// Cubre los cinco caracteres con significado en HTML: con esto un nombre como
// `"><script>` queda como texto y nunca cierra el atributo.
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Colapsa saltos de línea, tabs y espacios repetidos (la descripción se carga
// en un textarea y puede traer párrafos). También saca caracteres de control.
export function normalizarEspacios(texto: string): string {
  // eslint-disable-next-line no-control-regex
  return texto.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Corta en `max` caracteres (contando la elipsis), preferentemente en el
// último espacio para no partir una palabra. Trabaja por puntos de código,
// así no parte un emoji a la mitad.
export function truncar(texto: string, max: number): string {
  const limpio = normalizarEspacios(texto)
  const caracteres = Array.from(limpio)
  if (caracteres.length <= max) return limpio
  const corte = caracteres.slice(0, Math.max(0, max - 1)).join('')
  const ultimoEspacio = corte.lastIndexOf(' ')
  const base = ultimoEspacio > corte.length * 0.6 ? corte.slice(0, ultimoEspacio) : corte
  return `${base.replace(/[\s.,;:·—-]+$/, '')}…`
}

// Precio en pesos para la descripción ("$ 12.500"), o null si no es un número
// positivo. money() separa "$" con un espacio duro; se cambia por uno común.
export function precioArs(precio: ProductoOg['precio']): string | null {
  const n = typeof precio === 'string' ? Number(precio) : precio
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null
  return money(n).replace(/ /g, ' ')
}

// URL base del sitio: absoluta, http(s), sin barra final y sin caracteres que
// puedan romper un atributo. Si no sirve, el dominio de producción.
export function urlDelSitio(valor: string | null | undefined): string {
  const limpio = (valor ?? '').trim().replace(/\/+$/, '')
  return /^https?:\/\/[^\s"'<>]+$/i.test(limpio) ? limpio : SITIO_POR_DEFECTO
}

// URL absoluta y https de una imagen, o null si no se puede usar en una vista
// previa: las apps descartan (o marcan como insegura) una imagen por http, y
// un data: URI (el placeholder) no se puede descargar.
// Una ruta relativa ("/og-image.jpg") se completa con el sitio.
export function imagenAbsoluta(url: string | null | undefined, sitio: string): string | null {
  const valor = (url ?? '').trim()
  if (!valor) return null
  let absoluta: URL
  try {
    absoluta = valor.startsWith('/') && !valor.startsWith('//') ? new URL(valor, `${sitio}/`) : new URL(valor)
  } catch {
    return null
  }
  return absoluta.protocol === 'https:' ? absoluta.href : null
}

// ---- Qué producto se pide ---------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Forma exacta que produce public.slugify() (migración 0011): minúsculas,
// números y guiones simples, sin guion al principio ni al final.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_PARAM = 200

// Igual que ProductPage: el parámetro de /producto/:param es un uuid (links
// viejos) o un slug. Cualquier otra cosa no puede ser un producto: se contesta
// con la vista previa genérica sin consultar la base.
export function consultaDeParam(param: string | null | undefined): { columna: 'id' | 'slug'; valor: string } | null {
  if (!param) return null
  let valor = param
  try {
    valor = decodeURIComponent(param)
  } catch {
    return null
  }
  valor = valor.trim()
  if (!valor || valor.length > MAX_PARAM) return null
  if (UUID_RE.test(valor)) return { columna: 'id', valor: valor.toLowerCase() }
  if (SLUG_RE.test(valor)) return { columna: 'slug', valor }
  return null
}

// ---- Armado de las meta -----------------------------------------------------------

// Vista previa genérica del muestrario (la misma que trae index.html).
export function metaGenerica(sitioCrudo: string): MetaOg {
  const sitio = urlDelSitio(sitioCrudo)
  const imagen = `${sitio}/og-image.jpg`
  return {
    titulo: TITULO_GENERICO,
    canonica: `${sitio}/`,
    tags: [
      { atributo: 'name', clave: 'description', valor: DESCRIPCION_GENERICA },
      { atributo: 'property', clave: 'og:type', valor: 'website' },
      { atributo: 'property', clave: 'og:site_name', valor: 'Pecora' },
      { atributo: 'property', clave: 'og:locale', valor: 'es_AR' },
      { atributo: 'property', clave: 'og:title', valor: TITULO_GENERICO },
      { atributo: 'property', clave: 'og:description', valor: DESCRIPCION_GENERICA },
      { atributo: 'property', clave: 'og:url', valor: `${sitio}/` },
      { atributo: 'property', clave: 'og:image', valor: imagen },
      { atributo: 'property', clave: 'og:image:type', valor: 'image/jpeg' },
      { atributo: 'property', clave: 'og:image:width', valor: '1200' },
      { atributo: 'property', clave: 'og:image:height', valor: '630' },
      { atributo: 'property', clave: 'og:image:alt', valor: TITULO_GENERICO },
      { atributo: 'name', clave: 'twitter:card', valor: 'summary_large_image' },
      { atributo: 'name', clave: 'twitter:title', valor: TITULO_GENERICO },
      { atributo: 'name', clave: 'twitter:description', valor: DESCRIPCION_GENERICA },
      { atributo: 'name', clave: 'twitter:image', valor: imagen },
    ],
  }
}

// Descripción de la tarjeta: descripción corta + precio. Sin descripción, el
// precio con una frase de la marca; sin precio, solo la descripción.
export function descripcionProducto(p: Pick<ProductoOg, 'descripcion' | 'precio'>): string {
  const precio = precioArs(p.precio)
  const sufijo = precio ? ` · ${precio}` : ''
  const texto = normalizarEspacios(p.descripcion ?? '')
  if (!texto) {
    return precio ? `${precio} · Accesorios textiles para bebés hechos a mano.` : DESCRIPCION_GENERICA
  }
  // El precio siempre entra entero: se recorta solo la descripción.
  return `${truncar(texto, MAX_DESCRIPCION - Array.from(sufijo).length)}${sufijo}`
}

// Primera imagen utilizable del producto (galería y, si no, la portada).
// Se usa el original (JPEG de ~1400px ya comprimido al subirlo, ver
// imageCompress): la miniatura del bucket mide 480px, menos que los 600px que
// Facebook/X piden para la tarjeta grande, y puede no existir todavía.
export function imagenProducto(p: Pick<ProductoOg, 'imagenes' | 'imagen_url'>, sitio: string): string | null {
  const candidatas = [...(p.imagenes ?? []), p.imagen_url]
  for (const url of candidatas) {
    const absoluta = imagenAbsoluta(url, sitio)
    if (absoluta) return absoluta
  }
  return null
}

// Meta de un producto. Si el producto no sirve (null, sin nombre), devuelve
// las genéricas: nunca falla.
export function metaProducto(p: ProductoOg | null | undefined, sitioCrudo: string): MetaOg {
  const sitio = urlDelSitio(sitioCrudo)
  const nombre = normalizarEspacios(p?.nombre ?? '')
  if (!p || !nombre) return metaGenerica(sitio)

  const titulo = truncar(nombre, MAX_TITULO)
  const descripcion = descripcionProducto(p)
  // Mismo link que comparte la ficha (src/lib/share.ts): slug y, si no, id.
  const url = `${sitio}/producto/${encodeURIComponent(p.slug || p.id)}`
  const imagen = imagenProducto(p, sitio)

  const tags: MetaTag[] = [
    { atributo: 'name', clave: 'description', valor: descripcion },
    { atributo: 'property', clave: 'og:type', valor: 'product' },
    { atributo: 'property', clave: 'og:site_name', valor: 'Pecora' },
    { atributo: 'property', clave: 'og:locale', valor: 'es_AR' },
    { atributo: 'property', clave: 'og:title', valor: titulo },
    { atributo: 'property', clave: 'og:description', valor: descripcion },
    { atributo: 'property', clave: 'og:url', valor: url },
  ]
  if (imagen) {
    tags.push(
      { atributo: 'property', clave: 'og:image', valor: imagen },
      { atributo: 'property', clave: 'og:image:alt', valor: titulo },
    )
  } else {
    // Sin foto utilizable: la imagen genérica de la marca (con sus medidas).
    const generica = `${sitio}/og-image.jpg`
    tags.push(
      { atributo: 'property', clave: 'og:image', valor: generica },
      { atributo: 'property', clave: 'og:image:type', valor: 'image/jpeg' },
      { atributo: 'property', clave: 'og:image:width', valor: '1200' },
      { atributo: 'property', clave: 'og:image:height', valor: '630' },
      { atributo: 'property', clave: 'og:image:alt', valor: titulo },
    )
  }
  if (precioArs(p.precio)) {
    tags.push(
      { atributo: 'property', clave: 'product:price:amount', valor: String(Number(p.precio)) },
      { atributo: 'property', clave: 'product:price:currency', valor: 'ARS' },
    )
  }
  tags.push(
    { atributo: 'name', clave: 'twitter:card', valor: 'summary_large_image' },
    { atributo: 'name', clave: 'twitter:title', valor: titulo },
    { atributo: 'name', clave: 'twitter:description', valor: descripcion },
    { atributo: 'name', clave: 'twitter:image', valor: imagen ?? `${sitio}/og-image.jpg` },
  )
  return { titulo: `${titulo} · Pecora`, canonica: url, tags }
}

// ---- HTML -------------------------------------------------------------------------

// Bloque de <head> con el título, la canónica y las meta, todo escapado.
export function htmlDeMeta(meta: MetaOg): string {
  const lineas = [
    `<title>${escaparHtml(meta.titulo)}</title>`,
    `<link rel="canonical" href="${escaparHtml(meta.canonica)}" />`,
    ...meta.tags.map((t) => `<meta ${t.atributo}="${escaparHtml(t.clave)}" content="${escaparHtml(t.valor)}" />`),
  ]
  return lineas.map((l) => `    ${l}`).join('\n')
}

// Meta que se reemplazan: título, canónica, description y todas las og:,
// twitter: y product:. Las demás (charset, viewport, robots, íconos) quedan.
// Los valores de index.html nunca llevan ">" dentro, así que alcanza con
// cortar en el primer ">".
const TITULO_RE = /<title\b[^>]*>[\s\S]*?<\/title>\s*/gi
const CANONICA_RE = /<link\b[^>]*\brel=["']canonical["'][^>]*>\s*/gi
const META_RE = /<meta\b[^>]*\b(?:name|property)=["'](?:description|og:[^"']*|twitter:[^"']*|product:[^"']*)["'][^>]*>\s*/gi

// Reemplaza las meta de index.html por las de `meta`. Si el HTML no tiene
// </head> (no debería pasar), lo devuelve tal cual: mejor la vista previa
// genérica que una página rota.
export function inyectarMeta(html: string, meta: MetaOg): string {
  const cierre = html.search(/<\/head>/i)
  if (cierre < 0) return html
  const head = html
    .slice(0, cierre)
    .replace(TITULO_RE, '')
    .replace(CANONICA_RE, '')
    .replace(META_RE, '')
  return `${head.replace(/\s*$/, '\n')}${htmlDeMeta(meta)}\n  ${html.slice(cierre)}`
}

// Página mínima para cuando no se pudo obtener index.html: solo la usan los
// bots de vista previa (ver vercel.json), así que alcanza con las meta y un
// link al muestrario.
export function htmlDeRespaldo(meta: MetaOg): string {
  const url = escaparHtml(meta.canonica)
  return [
    '<!DOCTYPE html>',
    '<html lang="es">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    htmlDeMeta(meta),
    '  </head>',
    '  <body>',
    `    <p><a href="${url}">${escaparHtml(meta.titulo)}</a></p>`,
    '  </body>',
    '</html>',
    '',
  ].join('\n')
}
