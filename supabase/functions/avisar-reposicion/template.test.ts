import { describe, expect, it } from 'vitest'
import { asuntoAviso, formatPrecio, renderAvisoReposicion } from './template.ts'

const branding = { brandName: 'Pecora', brandLogoUrl: null, sitioUrl: 'https://a.test' }
const data = {
  nombreProducto: 'Body rosa',
  precio: 12500,
  fotoUrl: 'https://cdn.test/body.jpg',
  urlProducto: 'https://a.test/producto/body-rosa',
  urlBaja: 'https://a.test/aviso/baja?token=abc',
}

describe('asuntoAviso', () => {
  it('arma "¡Volvió <producto>!" sin saltos de línea', () => {
    expect(asuntoAviso('Body rosa')).toBe('¡Volvió Body rosa!')
    expect(asuntoAviso('Body\r\nBcc: x@y.test')).toBe('¡Volvió Body Bcc: x@y.test!')
    expect(asuntoAviso('   ')).toBe('¡Volvió el producto que esperabas!')
  })
})

describe('formatPrecio', () => {
  it('formatea en pesos y tolera valores no finitos', () => {
    expect(formatPrecio(12500).replace(/\s/g, ' ')).toBe('$12.500,00')
    expect(formatPrecio(Number.NaN)).toBe('$0,00')
  })
})

describe('renderAvisoReposicion', () => {
  it('incluye producto, precio, link al producto y link de baja', () => {
    const { subject, html } = renderAvisoReposicion(data, branding)
    expect(subject).toBe('¡Volvió Body rosa!')
    expect(html).toContain('¡Volvió Body rosa!')
    expect(html).toContain('$12.500,00')
    expect(html).toContain('href="https://a.test/producto/body-rosa"')
    expect(html).toContain('href="https://a.test/aviso/baja?token=abc"')
    expect(html).toContain('src="https://cdn.test/body.jpg"')
    expect(html).toContain('No quiero recibir más avisos')
  })

  it('sin foto no deja una imagen vacía', () => {
    const { html } = renderAvisoReposicion({ ...data, fotoUrl: null }, branding)
    expect(html).not.toContain('cdn.test')
  })

  it('escapa el nombre del producto y las URLs', () => {
    const { html } = renderAvisoReposicion(
      { ...data, nombreProducto: '<script>x</script>', urlProducto: 'https://a.test/p?a=1&b="2"' },
      branding,
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(html).toContain('href="https://a.test/p?a=1&amp;b=&quot;2&quot;"')
  })

  it('muestra el logo si está configurado', () => {
    const { html } = renderAvisoReposicion(data, { ...branding, brandLogoUrl: 'https://a.test/logo.png' })
    expect(html).toContain('src="https://a.test/logo.png"')
  })
})
