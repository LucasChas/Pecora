import { describe, expect, it } from 'vitest'
import { STOCK_BAJO, avisoStockBajo } from './stock'

describe('avisoStockBajo', () => {
  it('sin stock (o negativo) no hay aviso', () => {
    expect(avisoStockBajo(0)).toBeNull()
    expect(avisoStockBajo(-1)).toBeNull()
  })

  it('con una sola unidad avisa que es la última', () => {
    expect(avisoStockBajo(1)).toBe('¡Último disponible!')
  })

  it('con 2 o 3 unidades no avisa (es el stock normal de una tanda artesanal)', () => {
    expect(STOCK_BAJO).toBe(1)
    expect(avisoStockBajo(2)).toBeNull()
    expect(avisoStockBajo(3)).toBeNull()
  })

  it('por encima del umbral no hay aviso', () => {
    expect(avisoStockBajo(STOCK_BAJO + 1)).toBeNull()
    expect(avisoStockBajo(50)).toBeNull()
  })
})
