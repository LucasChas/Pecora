// Filtros extra del muestrario: rango de precio y "solo disponibles".
// Viven en la URL (?precio=min-max&stock=1) como la categoría y la búsqueda.
// Lógica pura, sin React, para poder testearla.

export interface RangoPrecio {
  /** Valor para la URL: "min-max", "-max" o "min-". */
  valor: string
  texto: string
  min: number | null
  max: number | null
}

/** Redondeo "lindo" para los cortes: 1.000, 5.000, 10.000, 25.000… */
export function redondearCorte(n: number): number {
  if (!(n > 0)) return 0
  const paso = n < 10000 ? 1000 : n < 50000 ? 5000 : 10000
  return Math.max(paso, Math.round(n / paso) * paso)
}

function plata(n: number): string {
  return `$${n.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

/**
 * Tres rangos según los precios que hay (tercios), con cortes redondeados.
 * Con pocos productos o precios muy parecidos, no hay rangos (no tiene sentido
 * filtrar).
 */
export function rangosDePrecio(precios: readonly number[]): RangoPrecio[] {
  const validos = precios.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b)
  if (validos.length < 4) return []
  const corte1 = redondearCorte(validos[Math.floor(validos.length / 3)])
  const corte2 = redondearCorte(validos[Math.floor((validos.length * 2) / 3)])
  if (!(corte1 > 0) || corte2 <= corte1) {
    if (!(corte1 > 0) || corte1 >= validos[validos.length - 1]) return []
    return [
      { valor: `-${corte1}`, texto: `Hasta ${plata(corte1)}`, min: null, max: corte1 },
      { valor: `${corte1}-`, texto: `Más de ${plata(corte1)}`, min: corte1, max: null },
    ]
  }
  return [
    { valor: `-${corte1}`, texto: `Hasta ${plata(corte1)}`, min: null, max: corte1 },
    { valor: `${corte1}-${corte2}`, texto: `${plata(corte1)} a ${plata(corte2)}`, min: corte1, max: corte2 },
    { valor: `${corte2}-`, texto: `Más de ${plata(corte2)}`, min: corte2, max: null },
  ]
}

/** Lee ?precio= ("min-max", "-max", "min-"). null si no es válido. */
export function leerRangoUrl(valor: string | null): { min: number | null; max: number | null } | null {
  if (!valor) return null
  const m = /^(\d{0,9})-(\d{0,9})$/.exec(valor.trim())
  if (!m || (!m[1] && !m[2])) return null
  const min = m[1] ? Number(m[1]) : null
  const max = m[2] ? Number(m[2]) : null
  if (min !== null && max !== null && min > max) return null
  return { min, max }
}

/** Cortes inclusivos abajo y exclusivos arriba, salvo el tope (incluido). */
export function enRango(precio: number, rango: { min: number | null; max: number | null } | null): boolean {
  if (!rango) return true
  if (rango.min !== null && precio < rango.min) return false
  if (rango.max !== null && precio > rango.max) return false
  return true
}

// ---- Sugerencias del buscador -------------------------------------------------

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Hasta `max` productos para sugerir mientras se escribe. Primero los que
 * empiezan con lo escrito, después los que lo tienen en alguna palabra del
 * nombre y por último los que coinciden en categoría; dentro de cada grupo,
 * los disponibles primero.
 */
export function sugerencias<T extends { nombre: string; stock: number; categoria_nombre?: string | null }>(
  productos: readonly T[],
  consulta: string,
  max = 5,
): T[] {
  const q = normalizar(consulta)
  if (q.length < 2) return []
  const palabras = q.split(/\s+/).filter(Boolean)
  const puntaje = (p: T): number => {
    const nombre = normalizar(p.nombre)
    const cat = normalizar(p.categoria_nombre ?? '')
    if (nombre.startsWith(q)) return 3
    const enNombre = palabras.every((w) => nombre.split(/[^a-z0-9ñ]+/).some((x) => x.startsWith(w)) || nombre.includes(w))
    if (enNombre) return 2
    if (palabras.every((w) => cat.includes(w) || nombre.includes(w))) return 1
    return 0
  }
  return productos
    .map((p) => ({ p, s: puntaje(p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || Number(b.p.stock > 0) - Number(a.p.stock > 0))
    .slice(0, max)
    .map((x) => x.p)
}
