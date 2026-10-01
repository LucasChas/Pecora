// Formatea un número como precio en pesos argentinos (sin decimales).
export function money(n: number): string {
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  })
}

// Texto para comparar en búsquedas: minúsculas y sin acentos, así "algodon"
// encuentra "algodón" y "bebe" encuentra "bebé" (en el celular casi nadie
// escribe los acentos).
export function paraBuscar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

// true si cada palabra de la búsqueda aparece en alguno de los textos.
export function coincideBusqueda(busqueda: string, ...textos: (string | null | undefined)[]): boolean {
  const palabras = paraBuscar(busqueda).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return true
  const donde = paraBuscar(textos.filter(Boolean).join(' '))
  return palabras.every((p) => donde.includes(p))
}
