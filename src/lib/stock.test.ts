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

  it(`de 2 a ${STOCK_BAJO} unidades avisa la cantidad`, () => {
    expect(avisoStockBajo(2)).toBe('¡Últimas 2 unidades!')
    expect(avisoStockBajo(STOCK_BAJO)).toBe(`¡Últimas ${STOCK_BAJO} unidades!`)
  })

  it('por encima del umbral no hay aviso', () => {
    expect(avisoStockBajo(STOCK_BAJO + 1)).toBeNull()
    expect(avisoStockBajo(50)).toBeNull()
  })
})
