import { describe, expect, it } from 'vitest'
import {
  LEYENDA_NO_FACTURA,
  armarComprobante,
  contactoTienda,
  entregaComprobante,
  estadoVisible,
  fechaHoraTienda,
  lineaLocalidad,
  lineasTotales,
  tituloDocumento,
} from './comprobante'
import type { Pedido } from '../types'

// Intl separa "$" del número con un espacio duro: se normaliza para comparar.
const plano = (s: string) => s.replace(/\s/g, ' ')

function pedido(extra: Partial<Pedido> = {}): Pedido {
  return {
    id: 'p1',
    numero: 42,
    nombre: 'Ana Pérez',
    telefono: '3515551234',
    email: 'ana@example.com',
    entrega: 'envio',
    direccion: 'San Martín 123',
    localidad: 'Córdoba',
    cp: '5000',
    provincia: 'Córdoba',
    notas: null,
    items: [
      { id: 'a', nombre: 'Body algodón', precio: 10000, cantidad: 2 },
      { id: 'b', nombre: 'Gorro', precio: 5000, cantidad: 1 },
    ],
    subtotal: 25000,
    estado: 'nuevo',
    origen: 'checkout',
    created_at: '2026-09-28T02:30:00Z',
    eliminado_at: null,
    ...extra,
  }
}

const TIENDA = {
  whatsapp: '+5493543582028',
  instagram: 'pecorababy',
  direccion: 'Av. Siempreviva 742, Córdoba',
  catalogo: 'pecora-muestrario.vercel.app',
}

describe('fechaHoraTienda', () => {
  it('usa la hora de Córdoba (UTC-3), no la del dispositivo', () => {
    // 02:30 UTC del 28 = 23:30 del 27 en Argentina.
    expect(fechaHoraTienda('2026-09-28T02:30:00Z')).toBe('27/09/2026 23:30')
  })

  it('devuelve cadena vacía si la fecha no es válida', () => {
    expect(fechaHoraTienda('no-es-fecha')).toBe('')
  })
})

describe('estadoVisible', () => {
  it('respeta el estado del pedido', () => {
    expect(estadoVisible({ estado: 'entregado', eliminado_at: null })).toBe('entregado')
  })

  it('un pedido en la papelera se ve como cancelado', () => {
    expect(estadoVisible({ estado: 'confirmado', eliminado_at: '2026-09-28T10:00:00Z' })).toBe(
      'cancelado',
    )
  })
})

describe('lineaLocalidad', () => {
  it('une localidad, CP y provincia con lo que haya', () => {
    expect(lineaLocalidad({ localidad: 'Córdoba', cp: '5000', provincia: 'Córdoba' })).toBe(
      'Córdoba · CP 5000 · Córdoba',
    )
    expect(lineaLocalidad({ localidad: 'Villa Allende', cp: null })).toBe('Villa Allende')
    expect(lineaLocalidad({})).toBe('')
  })
})

describe('lineasTotales', () => {
  it('sin descuento ni costo de envío: subtotal, envío a coordinar y total', () => {
    const lineas = lineasTotales(pedido()).map((l) => ({ ...l, valor: plano(l.valor) }))
    expect(lineas).toEqual([
      { etiqueta: 'Subtotal', valor: '$ 25.000' },
      { etiqueta: 'Envío', valor: 'A coordinar' },
      { etiqueta: 'Total', valor: '$ 25.000', total: true },
    ])
  })

  it('con cupón de descuento y envío por zona', () => {
    const p = pedido({
      descuento: 2500,
      costo_envio: 3000,
      total: 25500,
      cupon_codigo: 'VERANO10',
      zona_nombre: 'Córdoba Capital',
    })
    const lineas = lineasTotales(p).map((l) => ({ ...l, valor: plano(l.valor) }))
    expect(lineas).toEqual([
      { etiqueta: 'Subtotal', valor: '$ 25.000' },
      { etiqueta: 'Descuento (VERANO10)', valor: '− $ 2.500' },
      { etiqueta: 'Envío (Córdoba Capital)', valor: '$ 3.000' },
      { etiqueta: 'Total', valor: '$ 25.500', total: true },
    ])
  })

  it('cupón de envío gratis: se nombra el cupón y el envío sale gratis', () => {
    const p = pedido({ descuento: 0, costo_envio: 0, cupon_codigo: 'ENVIOGRATIS' })
    const etiquetas = lineasTotales(p).map((l) => `${l.etiqueta}: ${plano(l.valor)}`)
    expect(etiquetas).toEqual([
      'Subtotal: $ 25.000',
      'Cupón: ENVIOGRATIS',
      'Envío: Gratis',
      'Total: $ 25.000',
    ])
  })

  it('con transportista, el envío lleva el transportista y el servicio', () => {
    const p = pedido({
      costo_envio: 6000,
      transportista: 'andreani',
      servicio_envio: 'sucursal',
      sucursal_envio: 'Sucursal Centro',
      zona_nombre: 'Interior',
    })
    const envio = lineasTotales(p).find((l) => l.etiqueta.startsWith('Envío'))
    expect(envio?.etiqueta).toBe('Envío (Andreani a sucursal)')
    expect(plano(envio?.valor ?? '')).toBe('$ 6.000')
  })

  it('retiro / a coordinar: el envío figura sin costo', () => {
    const p = pedido({ entrega: 'coordinar', direccion: null, localidad: null, cp: null })
    expect(lineasTotales(p).find((l) => l.etiqueta === 'Envío')?.valor).toBe('Sin costo')
  })

  it('tolera montos como texto (numeric de Postgres)', () => {
    const p = pedido({ subtotal: '25000' as unknown as number, total: '25000' as unknown as number })
    expect(plano(lineasTotales(p).slice(-1)[0]?.valor ?? '')).toBe('$ 25.000')
  })
})

describe('entregaComprobante', () => {
  it('retiro / a coordinar', () => {
    expect(entregaComprobante(pedido({ entrega: 'coordinar' }))).toEqual({
      metodo: 'Retiro / a coordinar',
      detalle: [],
    })
  })

  it('envío por zona', () => {
    expect(entregaComprobante(pedido({ zona_nombre: 'Córdoba Capital' }))).toEqual({
      metodo: 'Envío a domicilio',
      detalle: ['Zona: Córdoba Capital'],
    })
  })

  it('transportista a sucursal, con la sucursal', () => {
    const p = pedido({
      transportista: 'correo_argentino',
      servicio_envio: 'sucursal',
      sucursal_envio: 'CPA Nueva Córdoba',
      zona_nombre: 'Interior',
    })
    expect(entregaComprobante(p)).toEqual({
      metodo: 'Envío a sucursal',
      detalle: ['Transporte: Correo Argentino a sucursal', 'Sucursal: CPA Nueva Córdoba'],
    })
  })

  it('transportista a domicilio', () => {
    const p = pedido({ transportista: 'andreani', servicio_envio: 'domicilio' })
    expect(entregaComprobante(p)).toEqual({
      metodo: 'Envío a domicilio',
      detalle: ['Transporte: Andreani a domicilio'],
    })
  })

  it('envío sin zona ni transportista todavía', () => {
    expect(entregaComprobante(pedido())).toEqual({ metodo: 'Envío a domicilio', detalle: [] })
  })
})

describe('contactoTienda', () => {
  it('arma dirección, WhatsApp, Instagram y catálogo', () => {
    expect(contactoTienda(TIENDA)).toEqual([
      'Av. Siempreviva 742, Córdoba',
      'WhatsApp +5493543582028',
      'Instagram @pecorababy',
      'pecora-muestrario.vercel.app',
    ])
  })

  it('omite lo que no está configurado', () => {
    expect(contactoTienda({ whatsapp: '+5493543582028', instagram: '', direccion: '  ' })).toEqual([
      'WhatsApp +5493543582028',
    ])
    expect(contactoTienda({})).toEqual([])
  })

  it('no duplica la @ del usuario de Instagram', () => {
    expect(contactoTienda({ instagram: '@pecorababy' })).toEqual(['Instagram @pecorababy'])
  })
})

describe('armarComprobante', () => {
  it('arma el comprobante completo de un pedido activo', () => {
    const c = armarComprobante(pedido({ estado: 'confirmado', notas: '  Timbre 2B ' }), TIENDA)
    expect(c.titulo).toBe('Comprobante de compra')
    expect(c.numero).toBe(42)
    expect(c.fecha).toBe('27/09/2026 23:30')
    expect(c.estado).toBe('confirmado')
    expect(c.estadoTexto).toBe('Confirmado · en preparación')
    expect(c.cancelado).toBe(false)
    expect(c.leyenda).toBe(LEYENDA_NO_FACTURA)
    expect(c.leyenda).toBe('Documento no válido como factura')
    expect(c.clienteNombre).toBe('Ana Pérez')
    expect(c.cliente).toEqual([
      'Tel. 3515551234',
      'ana@example.com',
      'San Martín 123',
      'Córdoba · CP 5000 · Córdoba',
    ])
    expect(c.notas).toBe('Timbre 2B')
    expect(c.tienda).toHaveLength(4)
    expect(c.items.map((i) => ({ ...i, precioUnitario: plano(i.precioUnitario), importe: plano(i.importe) }))).toEqual([
      { nombre: 'Body algodón', cantidad: 2, precioUnitario: '$ 10.000', importe: '$ 20.000' },
      { nombre: 'Gorro', cantidad: 1, precioUnitario: '$ 5.000', importe: '$ 5.000' },
    ])
    expect(c.totales[c.totales.length - 1]?.total).toBe(true)
  })

  it('un pedido cancelado queda marcado como "Pedido cancelado"', () => {
    const c = armarComprobante(pedido({ estado: 'cancelado' }), TIENDA)
    expect(c.cancelado).toBe(true)
    expect(c.estado).toBe('cancelado')
    expect(c.estadoTexto).toBe('Pedido cancelado')
  })

  it('un pedido en la papelera también sale como cancelado', () => {
    const c = armarComprobante(pedido({ eliminado_at: '2026-09-28T12:00:00Z' }), TIENDA)
    expect(c.cancelado).toBe(true)
    expect(c.estadoTexto).toBe('Pedido cancelado')
  })

  it('retiro: no imprime la dirección de la clienta ni datos vacíos', () => {
    const c = armarComprobante(
      pedido({ entrega: 'coordinar', email: null, direccion: 'vieja', localidad: null, cp: null, provincia: null }),
      {},
    )
    expect(c.cliente).toEqual(['Tel. 3515551234'])
    expect(c.tienda).toEqual([])
    expect(c.notas).toBeNull()
    expect(c.entrega.metodo).toBe('Retiro / a coordinar')
  })
})

describe('tituloDocumento', () => {
  it('nombre por defecto del PDF', () => {
    expect(tituloDocumento(42)).toBe('Pecora - Comprobante pedido #42')
  })
})
