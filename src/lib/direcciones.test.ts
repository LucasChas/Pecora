import { describe, expect, it } from 'vitest'
import { aliasSugerido, direccionPorDefecto, validarDireccion, yaGuardada, type Direccion } from './direcciones'

const d = (extra: Partial<Direccion> = {}): Direccion => ({
  id: '1',
  alias: 'Casa',
  direccion: 'San Martín 123',
  localidad: 'Córdoba',
  cp: '5000',
  provincia: 'Córdoba',
  principal: false,
  ...extra,
})

describe('direcciones', () => {
  it('valida los campos obligatorios y los largos', () => {
    expect(validarDireccion({ ...d(), alias: ' ' })).toMatch(/nombre/)
    expect(validarDireccion({ ...d(), direccion: '' })).toMatch(/calle/)
    expect(validarDireccion({ ...d(), localidad: '' })).toMatch(/localidad/)
    expect(validarDireccion({ ...d(), alias: 'a'.repeat(41) })).toMatch(/40/)
    expect(validarDireccion(d())).toBeNull()
  })

  it('reconoce una dirección ya guardada sin importar mayúsculas ni espacios', () => {
    expect(yaGuardada([d()], { direccion: ' san  martín 123 ', localidad: 'CÓRDOBA', cp: '5000' })).toBe(true)
    expect(yaGuardada([d()], { direccion: 'San Martín 124', localidad: 'Córdoba', cp: '5000' })).toBe(false)
  })

  it('propone la principal, o la primera', () => {
    expect(direccionPorDefecto([d({ id: 'a' }), d({ id: 'b', principal: true })])?.id).toBe('b')
    expect(direccionPorDefecto([d({ id: 'a' })])?.id).toBe('a')
    expect(direccionPorDefecto([])).toBeNull()
  })

  it('sugiere un nombre que no esté usado', () => {
    expect(aliasSugerido([])).toBe('Casa')
    expect(aliasSugerido([d()])).toBe('Dirección 2')
    expect(aliasSugerido([d(), d({ id: '2', alias: 'Dirección 2' })])).toBe('Dirección 3')
  })
})
