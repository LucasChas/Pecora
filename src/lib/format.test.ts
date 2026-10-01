import { describe, expect, it } from 'vitest'
import { coincideBusqueda, money } from './format'

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

describe('coincideBusqueda', () => {
  it('ignora acentos y mayúsculas', () => {
    expect(coincideBusqueda('algodon', 'Body de Algodón')).toBe(true)
    expect(coincideBusqueda('BEBE', 'Manta bebé')).toBe(true)
  })

  it('cada palabra puede estar en cualquier texto y en cualquier orden', () => {
    expect(coincideBusqueda('manta rosa', 'Manta tejida', 'Color rosa')).toBe(true)
    expect(coincideBusqueda('rosa manta', 'Manta tejida rosa')).toBe(true)
    expect(coincideBusqueda('manta azul', 'Manta tejida rosa')).toBe(false)
  })

  it('búsqueda vacía coincide con todo; textos nulos se ignoran', () => {
    expect(coincideBusqueda('  ', 'lo que sea')).toBe(true)
    expect(coincideBusqueda('body', null, undefined, 'Body')).toBe(true)
  })
})
