// Umbral para avisar "pocas unidades" en el catálogo.
export const STOCK_BAJO = 3

// Mensaje de stock bajo para mostrar en la card / detalle (o null si no aplica).
// Solo tiene sentido cuando hay stock (> 0).
export function avisoStockBajo(stock: number): string | null {
  if (stock <= 0) return null
  if (stock === 1) return '¡Último disponible!'
  if (stock <= STOCK_BAJO) return `¡Últimas ${stock} unidades!`
  return null
}
