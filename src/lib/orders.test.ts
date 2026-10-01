import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// El cliente real exige variables de entorno y habla con la red: se reemplaza
// por un rpc simulado (vi.hoisted para que exista cuando corre vi.mock).
const rpc = vi.hoisted(() => vi.fn())
// Consulta encadenable (from().select().eq().eq().maybeSingle()).
const consulta = vi.hoisted(() => ({
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}))
const from = vi.hoisted(() => vi.fn())
vi.mock('./supabaseClient', () => ({ supabase: { rpc, from } }))

import {
  MENSAJE_CUPON_NO_DISPONIBLE,
  PROVINCIAS_AR,
  calcularSubtotal,
  crearPedido,
  detalleDe,
  leerPedidoCreado,
  esFirmaInexistente,
  lineasDesglose,
  montoLinea,
  nuevaClaveIdempotencia,
  textoEnvio,
  totalesDe,
  type NuevoPedido,
} from './orders'
import { ErrorCotizacionVencida, MENSAJE_COTIZACION_VENCIDA } from './transportistas'

// Intl separa "$" del número con un espacio duro: se normaliza para comparar.
const plano = (s: string) => s.replace(/\s/g, ' ')

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('calcularSubtotal', () => {
  it('suma precio × cantidad', () => {
    expect(
      calcularSubtotal([
        { precio: 1500, cantidad: 2 },
        { precio: 800, cantidad: 1 },
      ]),
    ).toBe(3800)
  })

  it('sin ítems da 0', () => {
    expect(calcularSubtotal([])).toBe(0)
  })
})

describe('totalesDe', () => {
  it('tolera filas sin las columnas nuevas (antes de la migración)', () => {
    expect(totalesDe({ subtotal: 5000 })).toEqual({
      subtotal: 5000,
      descuento: 0,
      costoEnvio: 0,
      total: 5000,
    })
  })

  it('calcula el total si no viene: subtotal - descuento + envío', () => {
    expect(totalesDe({ subtotal: 5000, descuento: 500, costo_envio: 1200 }).total).toBe(5700)
  })

  it('respeta el total de la base cuando viene', () => {
    expect(totalesDe({ subtotal: 5000, descuento: 0, costo_envio: 0, total: 4900 }).total).toBe(4900)
  })

  it('trata null como 0 y acepta montos como texto (numeric)', () => {
    const pedido = {
      subtotal: '5000.00',
      descuento: null,
      costo_envio: '1000.50',
      total: null,
    } as unknown as Parameters<typeof totalesDe>[0]
    expect(totalesDe(pedido)).toEqual({
      subtotal: 5000,
      descuento: 0,
      costoEnvio: 1000.5,
      total: 6000.5,
    })
  })
})

describe('lineasDesglose / montoLinea / textoEnvio', () => {
  it('sin descuento ni envío no hay desglose', () => {
    expect(lineasDesglose(totalesDe({ subtotal: 3000 }))).toEqual([])
  })

  it('con descuento y envío: subtotal, descuento (negativo) y envío', () => {
    const t = totalesDe({ subtotal: 3000, descuento: 300, costo_envio: 900 })
    expect(lineasDesglose(t)).toEqual([
      { concepto: 'Subtotal', etiqueta: 'Subtotal', importe: 3000 },
      { concepto: 'Descuento', etiqueta: 'Descuento', importe: -300 },
      { concepto: 'Envío', etiqueta: 'Envío', importe: 900 },
    ])
  })

  it('nombra el cupón en el descuento y la zona en el envío', () => {
    const t = totalesDe({ subtotal: 3000, descuento: 300, costo_envio: 900 })
    const lineas = lineasDesglose(t, { cupon: 'VERANO10', zona: 'AMBA' })
    expect(lineas.map((l) => l.etiqueta)).toEqual(['Subtotal', 'Descuento (VERANO10)', 'Envío (AMBA)'])
  })

  it('envío gratis por zona: línea "Gratis" aunque no haya descuento', () => {
    const lineas = lineasDesglose(totalesDe({ subtotal: 3000 }), { zona: 'Córdoba Capital' })
    expect(lineas).toEqual([
      { concepto: 'Subtotal', etiqueta: 'Subtotal', importe: 3000 },
      { concepto: 'Envío', etiqueta: 'Envío (Córdoba Capital)', importe: 0, texto: 'Gratis' },
    ])
  })

  it('cupón de envío gratis (sin descuento): se nombra en la línea de envío', () => {
    const lineas = lineasDesglose(totalesDe({ subtotal: 3000 }), { cupon: 'ENVIOGRATIS', zona: 'AMBA' })
    expect(lineas[1]).toMatchObject({ etiqueta: 'Envío (AMBA · cupón ENVIOGRATIS)', texto: 'Gratis' })
  })

  it('el descuento lleva el signo menos tipográfico', () => {
    expect(plano(montoLinea(-300))).toBe('− $ 300')
    expect(plano(montoLinea(900))).toBe('$ 900')
  })

  it('envío: costo si está cargado; si no, "A coordinar" o "Sin costo"', () => {
    expect(textoEnvio(totalesDe({ subtotal: 1, costo_envio: 0 }), 'envio')).toBe('A coordinar')
    expect(textoEnvio(totalesDe({ subtotal: 1 }), 'coordinar')).toBe('Sin costo')
    expect(plano(textoEnvio(totalesDe({ subtotal: 1, costo_envio: 1500 }), 'envio'))).toBe('$ 1.500')
  })

  it('envío con zona y sin costo es "Gratis"; retiro sigue "Sin costo"', () => {
    expect(textoEnvio(totalesDe({ subtotal: 1 }), 'envio', { zona: 'AMBA' })).toBe('Gratis')
    expect(textoEnvio(totalesDe({ subtotal: 1 }), 'coordinar', { zona: 'AMBA' })).toBe('Sin costo')
  })

  it('detalleDe tolera filas sin las columnas de cupón / zona', () => {
    expect(detalleDe({})).toEqual({ cupon: null, zona: null })
    expect(detalleDe({ cupon_codigo: 'X10', zona_nombre: ' AMBA ' })).toEqual({ cupon: 'X10', zona: 'AMBA' })
  })
})

describe('PROVINCIAS_AR', () => {
  it('tiene las 24 jurisdicciones, CABA incluida', () => {
    expect(PROVINCIAS_AR).toHaveLength(24)
    expect(new Set(PROVINCIAS_AR).size).toBe(24)
    expect(PROVINCIAS_AR).toContain('Ciudad Autónoma de Buenos Aires')
  })
})

describe('esFirmaInexistente', () => {
  it('reconoce "función no encontrada" de PostgREST y de Postgres', () => {
    expect(esFirmaInexistente({ code: 'PGRST202', message: 'x' })).toBe(true)
    expect(esFirmaInexistente({ code: '42883', message: 'x' })).toBe(true)
    expect(
      esFirmaInexistente({
        message:
          'Could not find the function public.crear_pedido(p_cp, p_email, p_provincia) in the schema cache',
      }),
    ).toBe(true)
  })

  it('no confunde los errores de negocio de la función', () => {
    expect(
      esFirmaInexistente({
        code: 'P0001',
        message: 'De "Body" nos queda 1 unidad. Ajustá la cantidad y volvé a intentar.',
      }),
    ).toBe(false)
  })
})

describe('nuevaClaveIdempotencia', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('genera un UUID v4', () => {
    expect(nuevaClaveIdempotencia()).toMatch(UUID_V4)
  })

  it('sin crypto.randomUUID (contexto no seguro) lo arma con getRandomValues', () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) })
    const a = nuevaClaveIdempotencia()
    const b = nuevaClaveIdempotencia()
    expect(a).toMatch(UUID_V4)
    expect(b).toMatch(UUID_V4)
    expect(a).not.toBe(b)
  })
})

describe('crearPedido', () => {
  const base: NuevoPedido = {
    datos: {
      nombre: '  Ana Pérez ',
      telefono: '3541 123456',
      email: '',
      entrega: 'envio',
      direccion: 'San Martín 123',
      localidad: 'Carlos Paz',
      cp: '5152',
      provincia: 'Córdoba',
      notas: '  ',
    },
    items: [
      { id: 'a', nombre: 'Body', precio: 1500, cantidad: 2 },
      { id: 'b', nombre: 'Gorro', precio: 800, cantidad: 1 },
    ],
    idempotencyKey: '11111111-2222-4333-8444-555555555555',
  }

  beforeEach(() => {
    rpc.mockReset()
  })

  it('manda los ítems ordenados por id (evita bloqueos entre compras simultáneas)', async () => {
    rpc.mockResolvedValueOnce({ data: 7, error: null })
    await crearPedido({ ...base, items: [...base.items].reverse() })
    const args = rpc.mock.calls[0][1] as { p_items: { id: string }[] }
    expect(args.p_items.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('llama a crear_pedido con la firma nueva y devuelve el número', async () => {
    rpc.mockResolvedValueOnce({ data: 42, error: null })
    await expect(crearPedido(base)).resolves.toBe(42)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('crear_pedido', {
      p_nombre: 'Ana Pérez',
      p_telefono: '3541 123456',
      p_email: null,
      p_entrega: 'envio',
      p_direccion: 'San Martín 123',
      p_localidad: 'Carlos Paz',
      p_cp: '5152',
      p_notas: null,
      p_items: [
        { id: 'a', nombre: 'Body', precio: 1500, cantidad: 2 },
        { id: 'b', nombre: 'Gorro', precio: 800, cantidad: 1 },
      ],
      p_subtotal: 3800,
      p_origen: 'checkout',
      p_provincia: 'Córdoba',
      p_idempotency_key: '11111111-2222-4333-8444-555555555555',
    })
  })

  it('retiro: no manda dirección ni provincia; respeta el origen', async () => {
    rpc.mockResolvedValueOnce({ data: '7', error: null })
    const numero = await crearPedido({
      ...base,
      datos: { ...base.datos, entrega: 'coordinar' },
      origen: 'admin',
      idempotencyKey: undefined,
    })
    expect(numero).toBe(7)
    const args = rpc.mock.calls[0][1] as Record<string, unknown>
    expect(args).toMatchObject({
      p_entrega: 'coordinar',
      p_direccion: null,
      p_localidad: null,
      p_cp: null,
      p_provincia: null,
      p_origen: 'admin',
      p_idempotency_key: null,
    })
  })

  it('sin la migración aplicada reintenta UNA vez con la firma anterior (11 parámetros)', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function public.crear_pedido' },
      })
      .mockResolvedValueOnce({ data: 99, error: null })

    await expect(crearPedido(base)).resolves.toBe(99)
    expect(rpc).toHaveBeenCalledTimes(2)
    const anterior = rpc.mock.calls[1][1] as Record<string, unknown>
    expect(Object.keys(anterior)).toHaveLength(11)
    expect(anterior).not.toHaveProperty('p_provincia')
    expect(anterior).not.toHaveProperty('p_idempotency_key')
    expect(anterior).toMatchObject({ p_origen: 'checkout', p_subtotal: 3800 })
    expect(aviso).toHaveBeenCalledTimes(1)
    aviso.mockRestore()
  })

  it('si el reintento también falla, propaga ese error (sin más reintentos)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'no existe' } })
      .mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'Tu carrito está vacío.' } })
    await expect(crearPedido(base)).rejects.toThrow('Tu carrito está vacío.')
    expect(rpc).toHaveBeenCalledTimes(2)
    vi.restoreAllMocks()
  })

  it('los errores de negocio se muestran tal cual y no reintentan', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'De "Body" nos queda 1 unidad. Ajustá la cantidad y volvé a intentar.' },
    })
    await expect(crearPedido(base)).rejects.toThrow('De "Body" nos queda 1 unidad.')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('un corte de red da un mensaje amable', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '', message: 'TypeError: Failed to fetch' },
    })
    await expect(crearPedido(base)).rejects.toThrow(/No pudimos conectarnos/)
  })

  it('si la base no devuelve un número válido, no lo da por confirmado', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    await expect(crearPedido(base)).rejects.toThrow(/Mis pedidos/)
  })

  it('sin cupón no manda p_cupon (13 parámetros, sirve con y sin la migración)', async () => {
    rpc.mockResolvedValueOnce({ data: 5, error: null })
    await crearPedido({ ...base, cupon: '   ' })
    const args = rpc.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(args)).toHaveLength(13)
    expect(args).not.toHaveProperty('p_cupon')
  })

  it('con cupón manda p_cupon normalizado (14 parámetros)', async () => {
    rpc.mockResolvedValueOnce({ data: 8, error: null })
    await expect(crearPedido({ ...base, cupon: ' verano10 ' })).resolves.toBe(8)
    expect(rpc).toHaveBeenCalledTimes(1)
    const args = rpc.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(args)).toHaveLength(14)
    expect(args).toMatchObject({ p_cupon: 'VERANO10', p_provincia: 'Córdoba' })
  })

  it('con cupón y sin la migración de cupones: corta, no cobra sin el descuento', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'no existe' } })
    await expect(crearPedido({ ...base, cupon: 'VERANO10' })).rejects.toThrow(MENSAJE_CUPON_NO_DISPONIBLE)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(aviso).toHaveBeenCalledTimes(1)
    aviso.mockRestore()
  })

  it('un cupón inválido para la base se muestra tal cual', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'El cupón VERANO10 venció.' },
    })
    await expect(crearPedido({ ...base, cupon: 'VERANO10' })).rejects.toThrow('El cupón VERANO10 venció.')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe('crearPedido con cotización de transportista', () => {
  const base: NuevoPedido = {
    datos: {
      nombre: 'Ana',
      telefono: '3541 123456',
      entrega: 'envio',
      direccion: 'San Martín 123',
      localidad: 'Córdoba',
      cp: '5000',
      provincia: 'Córdoba',
    },
    items: [{ id: 'a', nombre: 'Body', precio: 1500, cantidad: 1 }],
    idempotencyKey: '11111111-2222-4333-8444-555555555555',
    cotizacionEnvio: ' q-123 ',
  }

  beforeEach(() => {
    rpc.mockReset()
  })

  it('manda p_cotizacion_envio (y p_cupon null) en una sola llamada', async () => {
    rpc.mockResolvedValueOnce({ data: 5, error: null })
    await expect(crearPedido(base)).resolves.toBe(5)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_cotizacion_envio: 'q-123', p_cupon: null })
  })

  it('con cupón manda los dos', async () => {
    rpc.mockResolvedValueOnce({ data: 5, error: null })
    await crearPedido({ ...base, cupon: 'verano10' })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_cotizacion_envio: 'q-123', p_cupon: 'VERANO10' })
  })

  it('retiro: ignora la cotización', async () => {
    rpc.mockResolvedValueOnce({ data: 5, error: null })
    await crearPedido({ ...base, datos: { ...base.datos, entrega: 'coordinar' } })
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_cotizacion_envio')
  })

  it('cotización vencida (22023): lanza ErrorCotizacionVencida sin reintentar', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'La cotización del envío venció.' } })
    const promesa = crearPedido(base)
    await expect(promesa).rejects.toBeInstanceOf(ErrorCotizacionVencida)
    await expect(promesa).rejects.toThrow(MENSAJE_COTIZACION_VENCIDA)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('sin la migración de transportistas: sigue sin la cotización (envío por zona)', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
      .mockResolvedValueOnce({ data: 8, error: null })
    await expect(crearPedido(base)).resolves.toBe(8)
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_cotizacion_envio')
    expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_cupon')
    expect(rpc.mock.calls[1][1]).toHaveProperty('p_idempotency_key')
    aviso.mockRestore()
  })

  it('sin la migración y con cupón: reintenta con cupón y sin cotización', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
      .mockResolvedValueOnce({ data: 9, error: null })
    await expect(crearPedido({ ...base, cupon: 'X' })).resolves.toBe(9)
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_cupon: 'X' })
    expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_cotizacion_envio')
    aviso.mockRestore()
  })

  it('otros errores de negocio se muestran tal cual', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'Tu carrito está vacío.' } })
    await expect(crearPedido(base)).rejects.toThrow('Tu carrito está vacío.')
  })
})

describe('detalleDe con transportista', () => {
  it('el transportista gana sobre la zona', () => {
    expect(
      detalleDe({ zona_nombre: 'AMBA', transportista: 'andreani', servicio_envio: 'sucursal', sucursal_envio: 'Centro' }),
    ).toEqual({ cupon: null, zona: 'Andreani a sucursal' })
    expect(detalleDe({ zona_nombre: 'AMBA', transportista: null })).toEqual({ cupon: null, zona: 'AMBA' })
  })
})

describe('leerPedidoCreado', () => {
  beforeEach(() => {
    from.mockReset().mockReturnValue(consulta)
    consulta.select.mockReset().mockReturnValue(consulta)
    consulta.eq.mockReset().mockReturnValue(consulta)
    consulta.maybeSingle.mockReset()
  })

  it('lee el pedido propio por número', async () => {
    const fila = { numero: 12, subtotal: 5000, descuento: 500, costo_envio: 1200, total: 5700 }
    consulta.maybeSingle.mockResolvedValueOnce({ data: fila, error: null })
    await expect(leerPedidoCreado(12, 'u1')).resolves.toEqual(fila)
    expect(from).toHaveBeenCalledWith('pedidos')
    expect(consulta.eq).toHaveBeenCalledWith('numero', 12)
    expect(consulta.eq).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('si no se puede leer devuelve null (no rompe el checkout)', async () => {
    consulta.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'x' } })
    await expect(leerPedidoCreado(12, 'u1')).resolves.toBeNull()
    consulta.maybeSingle.mockRejectedValueOnce(new Error('red'))
    await expect(leerPedidoCreado(12, 'u1')).resolves.toBeNull()
  })
})
