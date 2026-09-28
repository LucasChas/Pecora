import { describe, expect, it } from 'vitest'
import { money } from './format'

// Intl separa "$" del número con un espacio duro (U+00A0 o U+202F según la
// versión de ICU): se normaliza a un espacio común para comparar.
const plano = (s: string) => s.replace(/\s/g, ' ')

describe('money', () => {
  it('formatea en pesos argentinos con punto de miles', () => {
    expect(plano(money(14000))).toBe('$ 14.000')
    expect(plano(money(1234567))).toBe('$ 1.234.567')
    expect(plano(money(5))).toBe('$ 5')
    expect(plano(money(0))).toBe('$ 0')
  })

  it('no muestra decimales: redondea al peso', () => {
    expect(plano(money(1499.4))).toBe('$ 1.499')
    expect(plano(money(1499.5))).toBe('$ 1.500')
  })

  it('los negativos llevan el signo adelante', () => {
    expect(plano(money(-2500))).toBe('-$ 2.500')
  })
})
