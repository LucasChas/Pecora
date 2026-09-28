// Utilidades compartidas por los gráficos SVG del panel (Estadísticas y
// Rentabilidad). Sin dependencias de gráficos: barras dibujadas a mano.

// Montos cortos para los ejes: "$ 1,5 M", "$ 250 mil".
export const montoCompacto = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  notation: 'compact',
  maximumFractionDigits: 1,
})

// Techo "redondo" para el eje (1, 2, 2.5, 5 × 10^n).
export function techo(max: number): number {
  if (!(max > 0)) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(max)))
  for (const f of [1, 2, 2.5, 5, 10]) {
    if (f * exp >= max) return f * exp
  }
  return 10 * exp
}

// Dominio [min, max] del eje para valores que pueden ser negativos (ej.: un
// mes con pérdida). El 0 siempre queda incluido y los extremos son redondos.
export function dominio(valores: number[]): { min: number; max: number } {
  const alto = Math.max(0, ...valores.filter(Number.isFinite))
  const bajo = Math.min(0, ...valores.filter(Number.isFinite))
  return { min: bajo < 0 ? -techo(-bajo) : 0, max: alto > 0 ? techo(alto) : bajo < 0 ? 0 : 1 }
}
