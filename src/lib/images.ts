import type { Producto } from '../types'

// Placeholder cuando un producto no tiene ninguna imagen cargada.
export const IMG_PLACEHOLDER =
  'https://placehold.co/600x600/EEE1C4/B08F55?text=Pecora'

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
