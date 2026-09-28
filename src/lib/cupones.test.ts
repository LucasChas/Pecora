import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabaseClient', () => ({ supabase: { rpc } }))

import {
  describirCupon,
  esFuncionInexistente,
  esTablaInexistente,
  estadoCupon,
  normalizarCodigo,
  validarCupon,
  validarDatosCupon,
  type DatosCupon,
} from './cupones'

const plano = (s: string) => s.replace(/\s/g, ' ')

describe('normalizarCodigo', () => {
  it('saca espacios y pasa a mayúsculas', () => {
    expect(normalizarCodigo('  ver ano10 ')).toBe('VERANO10')
  })
})

describe('esFuncionInexistente / esTablaInexistente', () => {
  it('reconoce los códigos de PostgREST y Postgres', () => {
    expect(esFuncionInexistente({ code: 'PGRST202' }, 'validar_cupon')).toBe(true)
    expect(esFuncionInexistente({ code: '42883' }, 'validar_cupon')).toBe(true)
    expect(esFuncionInexistente({ code: 'P0001', message: 'Cupón vencido' }, 'validar_cupon')).toBe(false)
    expect(esTablaInexistente({ code: '42P01' })).toBe(true)
    expect(esTablaInexistente({ code: 'PGRST205' })).toBe(true)
    expect(esTablaInexistente({ message: 'relation "public.cupones" does not exist' })).toBe(true)
    expect(esTablaInexistente({ code: '23505', message: 'duplicate key' })).toBe(false)
  })
})

describe('validarCupon', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('sin código no llama a la base', async () => {
    const r = await validarCupon('   ', 5000)
    expect(r.valido).toBe(false)
    expect(r.mensaje).toMatch(/Ingresá/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('cupón válido: normaliza el código y lee el descuento (numeric como texto)', async () => {
    rpc.mockResolvedValueOnce({
      data: { valido: true, codigo: 'VERANO10', tipo: 'porcentaje', descuento: '500.00', envio_gratis: false, mensaje: null },
      error: null,
    })
    const r = await validarCupon('verano10', 5000)
    expect(rpc).toHaveBeenCalledWith('validar_cupon', { p_codigo: 'VERANO10', p_subtotal: 5000 })
    expect(r).toEqual({
      valido: true,
      codigo: 'VERANO10',
      tipo: 'porcentaje',
      descuento: 500,
      envioGratis: false,
      mensaje: null,
      disponible: true,
    })
  })

  it('pedido manual: manda p_pedido_manual = true (la base lo respeta solo para admin)', async () => {
    rpc.mockResolvedValueOnce({
      data: { valido: true, codigo: 'BIENVENIDA', tipo: 'monto', descuento: 1000, envio_gratis: false },
      error: null,
    })
    const r = await validarCupon('bienvenida', 5000, { pedidoManual: true })
    expect(rpc).toHaveBeenCalledWith('validar_cupon', {
      p_codigo: 'BIENVENIDA',
      p_subtotal: 5000,
      p_pedido_manual: true,
    })
    expect(r.valido).toBe(true)
  })

  it('checkout: sin la opción (o en false) no manda p_pedido_manual', async () => {
    rpc.mockResolvedValue({ data: { valido: false, mensaje: 'x' }, error: null })
    await validarCupon('a', 100)
    await validarCupon('b', 100, { pedidoManual: false })
    expect(rpc).toHaveBeenNthCalledWith(1, 'validar_cupon', { p_codigo: 'A', p_subtotal: 100 })
    expect(rpc).toHaveBeenNthCalledWith(2, 'validar_cupon', { p_codigo: 'B', p_subtotal: 100 })
  })

  it('acepta la respuesta como arreglo de una fila y marca el envío gratis', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ valido: true, codigo: 'ENVIO', tipo: 'envio_gratis', descuento: 0, envio_gratis: true }],
      error: null,
    })
    const r = await validarCupon('envio', 5000)
    expect(r.valido).toBe(true)
    expect(r.envioGratis).toBe(true)
    expect(r.descuento).toBe(0)
  })

  it('el descuento nunca supera el subtotal', async () => {
    rpc.mockResolvedValueOnce({
      data: { valido: true, codigo: 'X', tipo: 'monto', descuento: 9000, envio_gratis: false },
      error: null,
    })
    expect((await validarCupon('x', 5000)).descuento).toBe(5000)
  })

  it('cupón inválido: devuelve el mensaje de la base', async () => {
    rpc.mockResolvedValueOnce({
      data: { valido: false, codigo: 'VIEJO', mensaje: 'Este cupón venció.' },
      error: null,
    })
    const r = await validarCupon('viejo', 5000)
    expect(r).toMatchObject({ valido: false, mensaje: 'Este cupón venció.', disponible: true, descuento: 0 })
  })

  it('sin la migración: cupones no disponibles (sin romper)', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'no existe' } })
    const r = await validarCupon('verano10', 5000)
    expect(r).toMatchObject({ valido: false, disponible: false })
    expect(r.mensaje).toMatch(/todavía no están disponibles/)
    aviso.mockRestore()
  })

  it('corte de red o excepción: mensaje amable', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Failed to fetch' } })
    expect((await validarCupon('a1b', 100)).mensaje).toMatch(/conexión/)
    rpc.mockRejectedValueOnce(new Error('boom'))
    expect((await validarCupon('a1b', 100)).mensaje).toMatch(/conexión/)
  })

  it('error de negocio (P0001): se muestra tal cual', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'Iniciá sesión para usar cupones.' } })
    expect((await validarCupon('abc', 100)).mensaje).toBe('Iniciá sesión para usar cupones.')
  })
})

describe('estadoCupon', () => {
  const ahora = Date.parse('2026-09-28T12:00:00Z')
  const base = { activo: true, desde: null, hasta: null, usos_max: null }

  it('activo, pausado, vencido, agotado y programado', () => {
    expect(estadoCupon(base, 0, ahora)).toBe('activo')
    expect(estadoCupon({ ...base, activo: false }, 0, ahora)).toBe('inactivo')
    expect(estadoCupon({ ...base, hasta: '2026-09-01T00:00:00Z' }, 0, ahora)).toBe('vencido')
    expect(estadoCupon({ ...base, usos_max: 3 }, 3, ahora)).toBe('agotado')
    expect(estadoCupon({ ...base, usos_max: 3 }, 2, ahora)).toBe('activo')
    expect(estadoCupon({ ...base, desde: '2026-10-01T00:00:00Z' }, 0, ahora)).toBe('programado')
  })

  it('pausado le gana a vencido', () => {
    expect(estadoCupon({ ...base, activo: false, hasta: '2020-01-01T00:00:00Z' }, 0, ahora)).toBe('inactivo')
  })
})

describe('describirCupon', () => {
  it('porcentaje, monto y envío gratis', () => {
    expect(describirCupon({ tipo: 'porcentaje', valor: 10 })).toBe('10% off')
    expect(plano(describirCupon({ tipo: 'monto', valor: 1500 }))).toBe('$ 1.500 off')
    expect(describirCupon({ tipo: 'envio_gratis', valor: 0 })).toBe('Envío gratis')
  })
})

describe('validarDatosCupon', () => {
  const ok: DatosCupon = {
    codigo: 'VERANO10',
    descripcion: null,
    tipo: 'porcentaje',
    valor: 10,
    minimo_compra: 0,
    desde: null,
    hasta: null,
    usos_max: null,
    usos_por_cliente: 1,
    solo_primera_compra: false,
    activo: true,
  }

  it('acepta datos válidos', () => {
    expect(validarDatosCupon(ok)).toBeNull()
    expect(validarDatosCupon({ ...ok, tipo: 'envio_gratis', valor: 0 })).toBeNull()
  })

  it('rechaza código corto o con símbolos, porcentaje fuera de rango y vigencia invertida', () => {
    expect(validarDatosCupon({ ...ok, codigo: 'ab' })).toMatch(/3 caracteres/)
    expect(validarDatosCupon({ ...ok, codigo: 'HOLA!' })).toMatch(/letras, números/)
    expect(validarDatosCupon({ ...ok, valor: 120 })).toMatch(/1 a 100/)
    expect(validarDatosCupon({ ...ok, tipo: 'monto', valor: 0 })).toMatch(/mayor a 0/)
    expect(validarDatosCupon({ ...ok, usos_max: 0 })).toMatch(/usos máximos/)
    expect(
      validarDatosCupon({ ...ok, desde: '2026-10-10T00:00:00Z', hasta: '2026-10-01T00:00:00Z' }),
    ).toMatch(/anterior/)
  })
})
