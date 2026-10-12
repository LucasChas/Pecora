import { describe, expect, it } from 'vitest'
import {
  renderAvisoDuena,
  renderRecibo,
  type AvisoDuenaData,
  type ReciboBranding,
  type ReciboData,
  type TotalesPedido,
} from './template.ts'

// Texto malicioso: si llega crudo al HTML, abre una etiqueta o un atributo.
const XSS = `<img src=x onerror="alert('x')">&`
const XSS_ESCAPADO = '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;'

const branding: ReciboBranding = {
  brandName: 'Pecora',
  brandLogoUrl: 'https://pecora.test/logo.png',
  storeUrl: 'https://pecora.test',
  whatsappUrl: 'https://wa.me/5493511234567',
}

const SIN_AJUSTES: TotalesPedido = { subtotal: 2500, descuento: 0, costoEnvio: 0, total: 2500 }

function recibo(extra: Partial<ReciboData> = {}): ReciboData {
  return {
    numero: 12,
    fecha: '27/09/2026',
    nombre: 'Ana',
    items: [
      { nombre: 'Body', precio: 1000, cantidad: 2 },
      { nombre: 'Gorro', precio: 500, cantidad: 1 },
    ],
    totales: SIN_AJUSTES,
    entrega: 'coordinar',
    ...extra,
  }
}

function aviso(extra: Partial<AvisoDuenaData> = {}): AvisoDuenaData {
  return {
    numero: 12,
    fecha: '27/09/2026, 10:30',
    cliente: { nombre: 'Ana', telefono: '351 123 4567', email: 'ana@mail.com' },
    entrega: 'envio',
    direccion: 'Calle 1',
    localidad: 'Córdoba',
    cp: '5000',
    provincia: 'Córdoba',
    notas: null,
    items: [{ nombre: 'Body', precio: 1000, cantidad: 2 }],
    totales: { subtotal: 2000, descuento: 0, costoEnvio: 0, total: 2000 },
    whatsappClienteUrl: 'https://wa.me/5493511234567?text=Hola',
    panelUrl: 'https://pecora.test/admin',
    ...extra,
  }
}

describe('renderRecibo', () => {
  it('arma el asunto con la marca y sin el número de pedido', () => {
    const { subject, html } = renderRecibo(recibo(), branding)
    expect(subject).toBe('Confirmación de tu pedido — Pecora')
    expect(html).not.toContain('#12')
  })

  it('escapa el nombre, los productos y la fecha', () => {
    const { html } = renderRecibo(
      recibo({ nombre: XSS, fecha: XSS, items: [{ nombre: XSS, precio: 1, cantidad: 1 }] }),
      branding,
    )
    expect(html).not.toContain('<img src=x')
    expect(html.split(XSS_ESCAPADO).length - 1).toBe(3)
  })

  it('escapa la marca, el logo y la URL de la tienda', () => {
    const { html } = renderRecibo(recibo(), {
      brandName: XSS,
      brandLogoUrl: `https://x.test/"><script>`,
      storeUrl: `javascript:"<b>`,
      whatsappUrl: `https://wa.me/1"><i>`,
    })
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('"<b>')
    expect(html).not.toContain('"><i>')
    expect(html).toContain('https://x.test/&quot;&gt;&lt;script&gt;')
  })

  it('saluda por el nombre o, sin nombre, en general', () => {
    expect(renderRecibo(recibo(), branding).html).toContain('¡Gracias por tu compra, Ana!')
    expect(renderRecibo(recibo({ nombre: null }), branding).html).toContain('¡Gracias por tu compra!</h1>')
  })

  it('aclara qué hacer si no hiciste el pedido', () => {
    expect(renderRecibo(recibo(), branding).html).toContain('Si no hiciste este pedido, podés ignorar este mail.')
  })

  it('sin descuento ni envío muestra solo el total', () => {
    const { html } = renderRecibo(recibo(), branding)
    expect(html).toContain('Total: $2.500,00')
    expect(html).not.toContain('Subtotal:')
    expect(html).not.toContain('Descuento:')
    expect(html).not.toContain('Envío:')
  })

  it('con descuento y costo de envío muestra subtotal, las dos líneas y el total', () => {
    const { html } = renderRecibo(
      recibo({
        entrega: 'envio',
        totales: { subtotal: 2500, descuento: 300, costoEnvio: 800, total: 3000 },
      }),
      branding,
    )
    expect(html).toContain('Subtotal: $2.500,00')
    expect(html).toContain('Descuento: -$300,00')
    expect(html).toContain('Envío: $800,00')
    expect(html).toContain('Total: $3.000,00')
    expect(html).not.toContain('a coordinar')
  })

  it('envío a domicilio sin costo cargado: "Envío: a coordinar"', () => {
    const { html } = renderRecibo(recibo({ entrega: 'envio' }), branding)
    expect(html).toContain('Envío: a coordinar')
    expect(html).toContain('Total: $2.500,00')
  })

  it('retiro sin costo no muestra la línea de envío', () => {
    const { html } = renderRecibo(recibo({ entrega: 'coordinar' }), branding)
    expect(html).not.toContain('Envío:')
    expect(html).toContain('Retiro / a coordinar')
  })

  it('un descuento de 0 o no numérico no aparece', () => {
    const { html } = renderRecibo(
      recibo({ totales: { subtotal: 2500, descuento: Number.NaN, costoEnvio: 0, total: 2500 } }),
      branding,
    )
    expect(html).not.toContain('Descuento:')
  })

  it('el botón de WhatsApp es opcional', () => {
    expect(renderRecibo(recibo(), branding).html).toContain('Escribinos por WhatsApp')
    expect(renderRecibo(recibo(), { ...branding, whatsappUrl: null }).html).not.toContain(
      'Escribinos por WhatsApp',
    )
  })
})

describe('renderAvisoDuena', () => {
  it('asunto: "Nuevo pedido #N · $ total", sin datos de la clienta', () => {
    const { subject } = renderAvisoDuena(
      aviso({ totales: { subtotal: 1234.5, descuento: 0, costoEnvio: 0, total: 1234.5 } }),
      branding,
    )
    expect(subject).toBe('Nuevo pedido #12 · $ 1.234,50')
    expect(subject).not.toContain('Ana')
  })

  it('escapa todos los datos de la clienta, la entrega, las notas y los productos', () => {
    const { html } = renderAvisoDuena(
      aviso({
        fecha: XSS,
        cliente: { nombre: XSS, telefono: XSS, email: XSS },
        direccion: XSS,
        localidad: XSS,
        cp: XSS,
        provincia: XSS,
        notas: XSS,
        items: [{ nombre: XSS, precio: 1, cantidad: 1 }],
      }),
      branding,
    )
    expect(html).not.toContain('<img src=x')
    // fecha + nombre, teléfono, email + dirección, localidad, CP, provincia + notas + producto
    expect(html.split(XSS_ESCAPADO).length - 1).toBe(10)
  })

  it('las notas conservan los saltos de línea, escapadas', () => {
    const { html } = renderAvisoDuena(aviso({ notas: 'Timbre <b>2</b>\r\nDejar en portería\nGracias' }), branding)
    expect(html).toContain('Timbre &lt;b&gt;2&lt;/b&gt;<br />Dejar en portería<br />Gracias')
    expect(html).toContain('Notas de la clienta')
  })

  it('omite las filas vacías y la sección de notas si no hay', () => {
    const { html } = renderAvisoDuena(
      aviso({ entrega: 'coordinar', direccion: null, localidad: '  ', cp: null, provincia: null, notas: '' }),
      branding,
    )
    expect(html).not.toContain('Dirección')
    expect(html).not.toContain('Localidad')
    expect(html).not.toContain('Notas de la clienta')
    expect(html).toContain('Retiro / a coordinar')
  })

  it('muestra siempre el subtotal y el total; descuento y envío solo si son > 0', () => {
    const sinAjustes = renderAvisoDuena(aviso({ entrega: 'coordinar' }), branding).html
    expect(sinAjustes).toContain('Subtotal: $2.000,00')
    expect(sinAjustes).toContain('Total: $2.000,00')
    expect(sinAjustes).not.toContain('Descuento:')
    expect(sinAjustes).not.toContain('Envío:')

    const conAjustes = renderAvisoDuena(
      aviso({ totales: { subtotal: 2000, descuento: 200, costoEnvio: 500, total: 2300 } }),
      branding,
    ).html
    expect(conAjustes).toContain('Descuento: -$200,00')
    expect(conAjustes).toContain('Envío: $500,00')
    expect(conAjustes).toContain('Total: $2.300,00')
  })

  it('envío a domicilio sin costo: "Envío: a coordinar"', () => {
    const { html } = renderAvisoDuena(aviso({ entrega: 'envio' }), branding)
    expect(html).toContain('Envío: a coordinar')
  })

  it('los botones de WhatsApp y del panel son opcionales y escapan el link', () => {
    const conBotones = renderAvisoDuena(
      aviso({ whatsappClienteUrl: 'https://wa.me/1?text=a&b', panelUrl: 'https://pecora.test/admin' }),
      branding,
    ).html
    expect(conBotones).toContain('href="https://wa.me/1?text=a&amp;b"')
    expect(conBotones).toContain('Ver en el panel')

    const sinBotones = renderAvisoDuena(aviso({ whatsappClienteUrl: null, panelUrl: null }), branding).html
    expect(sinBotones).not.toContain('Escribirle por WhatsApp')
    expect(sinBotones).not.toContain('Ver en el panel')
  })
})
