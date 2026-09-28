import { LADO_MAX_MINIATURA } from './images'

// Comprime/redimensiona una imagen en el navegador ANTES de subirla a Storage.
// Las fotos del celular suelen pesar 1-5 MB; esto las baja a ~100-250 KB, lo que
// hace que el catálogo cargue mucho más rápido (sobre todo con datos móviles).
//
// Devuelve un Blob JPEG. Si algo falla (formato raro, navegador viejo), cae al
// archivo original para no romper la carga.
export async function comprimirImagen(
  file: File,
  maxLado = 1400,
  calidad = 0.82,
): Promise<Blob> {
  try {
    return (await redimensionarJpeg(file, maxLado, calidad)) ?? file
  } catch {
    return file
  }
}

// Miniatura JPEG (lado mayor <= LADO_MAX_MINIATURA) para la grilla, el carrito
// y el panel. A diferencia de comprimirImagen, si falla RECHAZA: una
// "miniatura" que en realidad es la foto grande no sirve de nada.
export async function crearMiniatura(
  fuente: Blob,
  maxLado = LADO_MAX_MINIATURA,
  calidad = 0.8,
): Promise<Blob> {
  const miniatura = await redimensionarJpeg(fuente, maxLado, calidad)
  if (!miniatura) throw new Error('no se pudo generar la miniatura')
  return miniatura
}

// Escala la imagen para que su lado mayor no pase de maxLado (nunca agranda)
// y la exporta como JPEG. null si el navegador no pudo dibujarla/exportarla.
async function redimensionarJpeg(
  fuente: Blob,
  maxLado: number,
  calidad: number,
): Promise<Blob | null> {
  const bitmap = await decodificar(fuente)
  const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * escala))
  const h = Math.max(1, Math.round(bitmap.height * escala))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // Fondo blanco por si la imagen original tenía transparencia (JPEG no la soporta).
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)
  } finally {
    bitmap.close?.()
  }

  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob((b) => res(b), 'image/jpeg', calidad),
  )
  canvas.width = 0 // suelta el buffer del canvas sin esperar al recolector
  return blob
}

// Decodifica respetando la orientación EXIF (fotos de celular giradas). Los
// navegadores que no conocen la opción la rechazan: ahí se decodifica sin ella.
async function decodificar(fuente: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(fuente, { imageOrientation: 'from-image' })
  } catch {
    return createImageBitmap(fuente)
  }
}
