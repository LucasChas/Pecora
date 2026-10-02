import { describe, expect, it } from 'vitest'
import {
  leerItemsCarrito,
  leerPedidoAviso,
  leerSeguimiento,
  lineasRecordatorio,
  mesAnterior,
  nombreMes,
  primerNombre,
  variacion,
} from './logica'
import { renderPedidoEnviado, renderRecordatorioCarrito, renderReporteMensual, renderStockBajo } from './template'

const ID = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'
const marca = { brandName: 'Pecora', brandLogoUrl: null, sitioUrl: 'https://pecora.test' }

describe('leerPedidoAviso', () => {
  it('reconoce cada tipo', () => {
    expect(leerPedidoAviso({ tipo: 'pedido_enviado', pedido_id: ID })).toEqual({ tipo: 'pedido_enviado', pedidoId: ID })
    expect(leerPedidoAviso({ tipo: 'envios_pendientes' })).toEqual({ tipo: 'envios_pendientes' })
    expect(leerPedidoAviso({ tipo: 'stock_bajo' })).toEqual({ tipo: 'stock_bajo' })
    expect(leerPedidoAviso({ tipo: 'carritos' })).toEqual({ tipo: 'carritos' })
    expect(leerPedidoAviso({ tipo: 'reporte_mensual', mes: '2026-09' })).toEqual({ tipo: 'reporte_mensual', mes: '2026-09' })
    expect(leerPedidoAviso({ tipo: 'reporte_mensual', mes: 'x' })).toEqual({ tipo: 'reporte_mensual', mes: null })
  })
  it('rechaza lo desconocido o sin id válido', () => {
    expect(leerPedidoAviso({ tipo: 'pedido_enviado', pedido_id: 'x' })).toBeNull()
    expect(leerPedidoAviso({ tipo: 'otro' })).toBeNull()
    expect(leerPedidoAviso(null)).toBeNull()
  })
})

describe('fechas del reporte', () => {
  it('mesAnterior usa la hora de Argentina', () => {
    expect(mesAnterior(new Date('2026-10-01T12:05:00Z'))).toBe('2026-09-01')
    // 1 de enero 01:00 UTC todavía es 31 de diciembre en Argentina.
    expect(mesAnterior(new Date('2026-01-01T01:00:00Z'))).toBe('2025-11-01')
    expect(mesAnterior(new Date('2026-01-15T12:00:00Z'))).toBe('2025-12-01')
  })
  it('nombreMes', () => {
    expect(nombreMes('2026-09')).toBe('septiembre 2026')
    expect(nombreMes('2025-12-01')).toBe('diciembre 2025')
  })
  it('variacion', () => {
    expect(variacion(150, 100)).toBe(50)
    expect(variacion(50, 100)).toBe(-50)
    expect(variacion(10, 0)).toBeNull()
  })
})

describe('seguimiento', () => {
  it('distingue link de código', () => {
    expect(leerSeguimiento('https://correo.test/x?1')).toEqual({ codigo: null, url: 'https://correo.test/x?1' })
    expect(leerSeguimiento(' AB123 ')).toEqual({ codigo: 'AB123', url: null })
    expect(leerSeguimiento('')).toEqual({ codigo: null, url: null })
    expect(leerSeguimiento('javascript:alert(1)')).toEqual({ codigo: 'javascript:alert(1)', url: null })
  })
})

describe('carritos', () => {
  it('leerItemsCarrito filtra basura y duplicados', () => {
    expect(
      leerItemsCarrito([
        { id: ID, cantidad: 2 },
        { id: ID, cantidad: 5 },
        { id: 'x', cantidad: 1 },
        { id: ID2, cantidad: 0 },
        null,
      ]),
    ).toEqual([{ id: ID, cantidad: 2 }])
    expect(leerItemsCarrito({})).toEqual([])
  })
  it('lineasRecordatorio saltea agotados y limita la cantidad al stock', () => {
    const lineas = lineasRecordatorio(
      [{ id: ID, cantidad: 5 }, { id: ID2, cantidad: 1 }],
      [
        { id: ID, nombre: 'Body', slug: 'body', precio: '1000', stock: 2 },
        { id: ID2, nombre: 'Gorro', slug: null, precio: 500, stock: 0 },
      ],
      (p) => `https://pecora.test/producto/${p.slug ?? p.id}`,
      () => null,
    )
    expect(lineas).toEqual([
      { nombre: 'Body', precio: 1000, cantidad: 2, foto: null, url: 'https://pecora.test/producto/body' },
    ])
  })
  it('primerNombre', () => {
    expect(primerNombre('  Ana María López ')).toBe('Ana')
    expect(primerNombre(null)).toBe('')
  })
})

describe('templates', () => {
  it('pedido enviado escapa datos y muestra el código', () => {
    const { subject, html } = renderPedidoEnviado(
      {
        nombre: '<b>Ana</b>',
        items: [{ nombre: 'Body <x>', cantidad: 1 }],
        seguimientoCodigo: 'AB123',
        seguimientoUrl: null,
        transportista: 'Andreani',
        misPedidosUrl: 'https://pecora.test/mis-pedidos',
        whatsappUrl: null,
      },
      marca,
    )
    expect(subject).toContain('en camino')
    expect(html).toContain('&lt;b&gt;Ana&lt;/b&gt;')
    expect(html).toContain('Body &lt;x&gt;')
    expect(html).toContain('AB123')
    expect(html).toContain('Andreani')
    expect(html).toContain('https://pecora.test/mis-pedidos')
    expect(html).not.toContain('<b>Ana</b>')
  })
  it('stock bajo arma el asunto según la cantidad', () => {
    expect(renderStockBajo([{ nombre: 'Body', stock: 2, url: null }], null, marca).subject).toBe('Stock bajo: Body (2)')
    const varios = renderStockBajo(
      [
        { nombre: 'Body', stock: 0, url: null },
        { nombre: 'Gorro', stock: 1, url: null },
      ],
      'https://admin.test',
      marca,
    )
    expect(varios.subject).toBe('Stock bajo en 2 productos (1 agotados)')
    expect(varios.html).toContain('Agotado')
    expect(varios.html).toContain('https://admin.test')
  })
  it('recordatorio de carrito con total y link a preferencias', () => {
    const { subject, html } = renderRecordatorioCarrito(
      {
        nombre: 'Ana',
        lineas: [{ nombre: 'Body', precio: 1000, cantidad: 2, foto: null, url: 'https://pecora.test/producto/body' }],
        carritoUrl: 'https://pecora.test/carrito',
        preferenciasUrl: 'https://pecora.test/mi-cuenta',
      },
      marca,
    )
    expect(subject).toContain('Ana')
    expect(html).toContain('https://pecora.test/carrito')
    expect(html).toContain('Mi cuenta → Preferencias')
    expect(html).toMatch(/\$2\.000/)
  })
  it('reporte mensual', () => {
    const { subject, html } = renderReporteMensual(
      {
        mesNombre: 'septiembre 2026',
        pedidos: 4,
        total: 40000,
        pedidosAnterior: 2,
        totalAnterior: 20000,
        variacionTotal: 100,
        cancelados: 1,
        gastos: 5000,
        clientasNuevas: 3,
        masVendidos: [{ nombre: 'Body <x>', unidades: 3, importe: 30000 }],
        sinStock: 2,
        pendientes: 1,
      },
      null,
      marca,
    )
    expect(subject).toBe('Resumen de septiembre 2026: $40.000 en 4 pedidos')
    expect(html).toContain('▲ 100%')
    expect(html).toContain('Body &lt;x&gt;')
    expect(html).toContain('2 productos agotados')
  })
})
