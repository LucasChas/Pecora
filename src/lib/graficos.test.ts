import { describe, expect, it } from 'vitest'
import { dominio, techo } from './graficos'

describe('graficos', () => {
  it('techo redondea hacia arriba', () => {
    expect(techo(0)).toBe(1)
    expect(techo(7100)).toBe(10000)
    expect(techo(2400)).toBe(2500)
    expect(techo(180)).toBe(200)
  })
  it('dominio incluye el 0 y los negativos', () => {
    expect(dominio([7100, 1700, 5400])).toEqual({ min: 0, max: 10000 })
    expect(dominio([2500, 3000, -500])).toEqual({ min: -500, max: 5000 })
    expect(dominio([0, 0])).toEqual({ min: 0, max: 1 })
    expect(dominio([0, 300, -300])).toEqual({ min: -500, max: 500 })
    expect(dominio([0, -300])).toEqual({ min: -500, max: 0 })
  })
})
