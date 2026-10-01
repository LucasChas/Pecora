import { describe, expect, it } from 'vitest'
import { linkWhatsappPedido, mensajePedido, telefonoParaWhatsapp } from './whatsapp'

describe('telefonoParaWhatsapp', () => {
  it.each([
    ['3515551234', '5493515551234'],
    ['0351 15 555-1234', '5493515551234'],
    ['351 15 5551234', '5493515551234'],
    ['+54 351 5551234', '5493515551234'],
    ['+54 9 351 555 1234', '5493515551234'],
    ['5493515551234', '5493515551234'],
    ['011 15 2345-6789', '5491123456789'],
    ['11 2345 6789', '5491123456789'],
    ['3543 15 582028', '5493543582028'],
    ['03543-582028', '5493543582028'],
    ['0054 9 11 2345 6789', '5491123456789'],
  ])('%s → %s', (entrada, esperado) => {
    expect(telefonoParaWhatsapp(entrada)).toBe(esperado)
  })

  it('números incompletos o vacíos no arman link', () => {
    expect(telefonoParaWhatsapp('')).toBeNull()
    expect(telefonoParaWhatsapp(null)).toBeNull()
    expect(telefonoParaWhatsapp('555-1234')).toBeNull()
  })

  it('un número extranjero con + se respeta', () => {
    expect(telefonoParaWhatsapp('+598 99 123 456')).toBe('59899123456')
  })
})

describe('mensajePedido', () => {
  it('cambia según el estado', () => {
    const base = { numero: 12, nombre: 'Ana Pérez', total: 15000 }
    expect(mensajePedido({ ...base, estado: 'nuevo' })).toContain('Hola Ana!')
    expect(mensajePedido({ ...base, estado: 'confirmado', entrega: 'envio' })).toMatch(/preparación.*despachemos/)
    expect(mensajePedido({ ...base, estado: 'confirmado', entrega: 'coordinar' })).toContain('retirar')
    expect(mensajePedido({ ...base, estado: 'entregado' })).toContain('¿Te llegó bien')
    expect(mensajePedido({ ...base, estado: 'enviado', seguimiento: 'AR123' })).toMatch(/en camino.*AR123/)
  })
})

describe('linkWhatsappPedido', () => {
  it('sin teléfono válido no hay link', () => {
    expect(linkWhatsappPedido({ numero: 1, nombre: 'Ana', estado: 'nuevo', telefono: '123' })).toBeNull()
  })

  it('arma el link con el mensaje', () => {
    const link = linkWhatsappPedido({ numero: 1, nombre: 'Ana', estado: 'nuevo', telefono: '3515551234' })
    expect(link).toMatch(/^https:\/\/wa\.me\/5493515551234\?text=Hola%20Ana!/)
  })
})
