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
    const bitmap = await createImageBitmap(file)
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * escala)
    const h = Math.round(bitmap.height * escala)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    // Fondo blanco por si la imagen original tenía transparencia (JPEG no la soporta).
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), 'image/jpeg', calidad),
    )
    return blob ?? file
  } catch {
    return file
  }
}
