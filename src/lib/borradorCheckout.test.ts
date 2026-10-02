import { describe, expect, it } from 'vitest'
import { borrarBorrador, errorTelefono, guardarBorrador, leerBorrador, type BorradorCheckout } from './borradorCheckout'

function almacen(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  }
}

const b: BorradorCheckout = {
  nombre: 'Ana', telefono: '3515551234', email: 'a@b.c', entrega: 'envio',
  direccion: 'San Martín 1', localidad: 'Córdoba', cp: '5000', provincia: 'Córdoba', notas: '',
}

describe('borrador del checkout', () => {
  it('guarda, lee y borra', () => {
    const a = almacen()
    guardarBorrador(b, a)
    expect(leerBorrador(a)).toEqual(b)
    borrarBorrador(a)
    expect(leerBorrador(a)).toEqual({})
  })

  it('ignora datos corruptos o con tipos raros', () => {
    const a = almacen()
    a.setItem('pecora-checkout-borrador', '{no es json')
    expect(leerBorrador(a)).toEqual({})
    a.setItem('pecora-checkout-borrador', JSON.stringify({ nombre: 3, entrega: 'avion', cp: '5000' }))
    expect(leerBorrador(a)).toEqual({ cp: '5000' })
  })

  it('sin almacenamiento no falla', () => {
    expect(leerBorrador(null)).toEqual({})
    expect(() => guardarBorrador(b, null)).not.toThrow()
  })
})

describe('errorTelefono', () => {
  it('pide el código de área', () => {
    expect(errorTelefono('555-1234')).toMatch(/código de área/)
    expect(errorTelefono('abc')).toMatch(/código de área/)
    expect(errorTelefono('351 555 1234')).toBeNull()
    expect(errorTelefono('+54 9 351 555-1234')).toBeNull()
    expect(errorTelefono('1'.repeat(16))).toMatch(/demasiados/)
  })
})

describe('errorEmail', () => {
  it('pide un email con formato válido', async () => {
    const { errorEmail } = await import('./borradorCheckout')
    expect(errorEmail('')).toMatch(/Escribí tu email/)
    expect(errorEmail('ana@')).toMatch(/mal escrito/)
    expect(errorEmail('ana gmail.com')).toMatch(/mal escrito/)
    expect(errorEmail(' ana@gmail.com ')).toBeNull()
  })
})
