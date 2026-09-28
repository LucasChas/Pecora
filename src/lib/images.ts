import type { Producto } from '../types'

// Placeholder cuando un producto no tiene ninguna imagen cargada. Es un SVG
// embebido (sin pedidos a terceros ni a la red): cuadrado crema con el nombre
// de la marca en camel, los mismos colores de tokens.css.
export const IMG_PLACEHOLDER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">' +
      '<rect width="600" height="600" fill="#EEE1C4"/>' +
      '<text x="300" y="318" text-anchor="middle" font-family="Georgia, serif" ' +
      'font-size="64" fill="#B08F55">Pecora</text>' +
      '</svg>',
  )

// Devuelve la galería de imágenes de un producto, con compatibilidad hacia atrás:
// usa la columna nueva "imagenes" y, si está vacía (o no corriste la migración
// 0002 todavía), cae a "imagen_url". Nunca devuelve un array vacío para la UI.
export function imagenesDe(producto: Pick<Producto, 'imagenes' | 'imagen_url'>): string[] {
  const galeria = (producto.imagenes ?? []).filter(Boolean)
  if (galeria.length > 0) return galeria
  if (producto.imagen_url) return [producto.imagen_url]
  return [IMG_PLACEHOLDER]
}

// Imagen de portada (la que va en la grilla del catálogo).
export function portadaDe(producto: Pick<Producto, 'imagenes' | 'imagen_url'>): string {
  return imagenesDe(producto)[0]
}

// ---- Miniaturas ---------------------------------------------------------------
//
// Cada foto del bucket "productos" tiene (o va a tener) una versión liviana de
// hasta LADO_MAX_MINIATURA px para la grilla, el carrito y el panel.
//
// Convención de nombres (determinística, derivada de la ruta del original):
//   <ruta>.<ext>  ->  thumbs/<ruta>.jpg
//   ej. "3f2a….jpg" -> "thumbs/3f2a….jpg", "vieja.png" -> "thumbs/vieja.jpg"
// La miniatura siempre es JPEG. Se sube junto con el original (ProductFormSheet)
// y las que falten (fotos viejas, una subida que falló) las genera solo el
// panel en segundo plano (lib/thumbnails).
//
// Una miniatura se pide únicamente si el registro de Storage dice que existe
// (lib/miniaturasDisponibles); si no, se muestra el original (ver Miniatura).

export const BUCKET_PRODUCTOS = 'productos'
export const CARPETA_MINIATURAS = 'thumbs'
export const LADO_MAX_MINIATURA = 480

// Prefijo de las URLs públicas del bucket (las que devuelve getPublicUrl).
const PREFIJO_PUBLICO = `${String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET_PRODUCTOS}/`

// Ruta del objeto dentro del bucket (sin codificar), o null si la URL no es
// de nuestro bucket (placeholder, otra web, otro proyecto).
export function rutaEnBucket(url: string): string | null {
  const codificada = rutaCodificada(url)
  if (codificada === null) return null
  try {
    return decodeURIComponent(codificada)
  } catch {
    return null
  }
}

// Ruta de la miniatura para la ruta de un original (ver convención arriba).
export function rutaMiniatura(rutaOriginal: string): string {
  return `${CARPETA_MINIATURAS}/${sinExtension(rutaOriginal)}.jpg`
}

// ¿La ruta ya es una miniatura? (no se hacen miniaturas de miniaturas)
export function esRutaMiniatura(ruta: string): boolean {
  return ruta.startsWith(`${CARPETA_MINIATURAS}/`)
}

// Ruta (sin codificar) de la miniatura que le corresponde a la URL de un
// original de nuestro bucket, para buscarla en el registro de miniaturas.
// null si la URL no es de nuestro bucket o ya es una miniatura.
export function rutaMiniaturaDe(url: string): string | null {
  const ruta = rutaEnBucket(url)
  return ruta === null || esRutaMiniatura(ruta) ? null : rutaMiniatura(ruta)
}

// URL de la miniatura de una foto de nuestro bucket; cualquier otra URL
// (placeholder, externas) vuelve tal cual.
export function miniaturaDe(url: string): string {
  const codificada = rutaCodificada(url)
  if (codificada === null || esRutaMiniatura(codificada)) return url
  // Se trabaja sobre la ruta ya codificada: solo cambia la carpeta y la
  // extensión (ASCII), así que la codificación del resto queda intacta.
  return PREFIJO_PUBLICO + rutaMiniatura(codificada)
}

// Ruta tal como aparece en la URL (codificada, sin query ni hash), o null.
function rutaCodificada(url: string): string | null {
  if (!PREFIJO_PUBLICO.startsWith('http') || !url.startsWith(PREFIJO_PUBLICO)) return null
  const ruta = url.slice(PREFIJO_PUBLICO.length).split(/[?#]/)[0]
  return ruta || null
}

// "a/b.png" -> "a/b" (solo la extensión del último tramo).
function sinExtension(ruta: string): string {
  return ruta.replace(/\.[^./]*$/, '')
}
