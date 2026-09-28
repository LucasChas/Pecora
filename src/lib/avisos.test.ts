import { beforeEach, describe, expect, it, vi } from 'vitest'

// Cliente simulado: rpc y una cadena from().select().eq().is().maybeSingle().
const { rpc, from, maybeSingle, eq, is } = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  const is = vi.fn(() => ({ maybeSingle }))
  const eq = vi.fn(() => ({ is }))
  const select = vi.fn(() => ({ eq }))
  return { rpc: vi.fn(), from: vi.fn(() => ({ select })), maybeSingle, eq, is }
})
vi.mock('./supabaseClient', () => ({ supabase: { rpc, from } }))

import {
  MENSAJE_ERROR_GENERICO,
  MENSAJE_NO_DISPONIBLE,
  cancelarAviso,
  consultarAviso,
  darDeBajaAviso,
  esTokenValido,
  mensajeDeError,
  suscribirAviso,
} from './avisos'

const PRODUCTO = '11111111-2222-4333-8444-555555555555'
const TOKEN = '3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b'

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('esTokenValido', () => {
  it('acepta uuids y rechaza lo demás', () => {
    expect(esTokenValido(TOKEN)).toBe(true)
    expect(esTokenValido(` ${TOKEN} `)).toBe(true)
    expect(esTokenValido('abc')).toBe(false)
    expect(esTokenValido(null)).toBe(false)
    expect(esTokenValido(undefined)).toBe(false)
  })
})

describe('mensajeDeError', () => {
  it('migración sin aplicar → aviso de no disponible', () => {
    expect(mensajeDeError({ code: 'PGRST202' })).toBe(MENSAJE_NO_DISPONIBLE)
    expect(mensajeDeError({ code: 'PGRST205' })).toBe(MENSAJE_NO_DISPONIBLE)
    expect(mensajeDeError({ code: '42883' })).toBe(MENSAJE_NO_DISPONIBLE)
  })

  it('los errores del RPC se muestran tal cual', () => {
    expect(mensajeDeError({ code: 'P0001', message: 'Este producto ya tiene stock.' })).toBe(
      'Este producto ya tiene stock.',
    )
    expect(mensajeDeError({ code: '42501', message: 'Tenés que ingresar.' })).toBe('Tenés que ingresar.')
  })

  it('cualquier otro error → mensaje genérico (sin detalles técnicos)', () => {
    expect(mensajeDeError({ code: '23505', message: 'duplicate key value' })).toBe(MENSAJE_ERROR_GENERICO)
    expect(mensajeDeError({ message: 'Failed to fetch' })).toBe(MENSAJE_ERROR_GENERICO)
  })
})

describe('consultarAviso', () => {
  it('devuelve el email de la suscripción pendiente', async () => {
    maybeSingle.mockResolvedValue({ data: { email: 'ana@a.test' }, error: null })
    await expect(consultarAviso(PRODUCTO)).resolves.toEqual({ ok: true, valor: 'ana@a.test' })
    expect(from).toHaveBeenCalledWith('avisos_stock')
    expect(eq).toHaveBeenCalledWith('producto_id', PRODUCTO)
    expect(is).toHaveBeenCalledWith('notificado_at', null)
  })

  it('sin suscripción → null', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    await expect(consultarAviso(PRODUCTO)).resolves.toEqual({ ok: true, valor: null })
  })

  it('tabla inexistente → no disponible', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: 'PGRST205', message: 'not found' } })
    await expect(consultarAviso(PRODUCTO)).resolves.toEqual({ ok: false, error: MENSAJE_NO_DISPONIBLE })
  })
})

describe('suscribirAviso', () => {
  it('llama al RPC y devuelve el email', async () => {
    rpc.mockResolvedValue({ data: 'ana@a.test', error: null })
    await expect(suscribirAviso(PRODUCTO)).resolves.toEqual({ ok: true, valor: 'ana@a.test' })
    expect(rpc).toHaveBeenCalledWith('suscribir_aviso_stock', { p_producto_id: PRODUCTO })
  })

  it('propaga el mensaje del RPC', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'Este producto ya tiene stock: lo podés comprar ahora.' },
    })
    await expect(suscribirAviso(PRODUCTO)).resolves.toEqual({
      ok: false,
      error: 'Este producto ya tiene stock: lo podés comprar ahora.',
    })
  })

  it('una respuesta vacía o una excepción no rompen', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await expect(suscribirAviso(PRODUCTO)).resolves.toEqual({ ok: false, error: MENSAJE_ERROR_GENERICO })
    rpc.mockRejectedValue(new Error('Failed to fetch'))
    await expect(suscribirAviso(PRODUCTO)).resolves.toEqual({ ok: false, error: MENSAJE_ERROR_GENERICO })
  })
})

describe('cancelarAviso', () => {
  it('llama al RPC y devuelve si había aviso', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    await expect(cancelarAviso(PRODUCTO)).resolves.toEqual({ ok: true, valor: true })
    expect(rpc).toHaveBeenCalledWith('cancelar_aviso_stock', { p_producto_id: PRODUCTO })
    rpc.mockResolvedValue({ data: false, error: null })
    await expect(cancelarAviso(PRODUCTO)).resolves.toEqual({ ok: true, valor: false })
  })
})

describe('darDeBajaAviso', () => {
  it('token válido → llama al RPC', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    await expect(darDeBajaAviso(TOKEN)).resolves.toEqual({ ok: true, valor: true })
    expect(rpc).toHaveBeenCalledWith('baja_aviso_stock', { p_token: TOKEN })
  })

  it('token inexistente → false', async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    await expect(darDeBajaAviso(TOKEN)).resolves.toEqual({ ok: true, valor: false })
  })

  it('token con formato inválido → false sin llamar a la base', async () => {
    await expect(darDeBajaAviso('no-es-un-token')).resolves.toEqual({ ok: true, valor: false })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('error del RPC → mensaje', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'x' } })
    await expect(darDeBajaAviso(TOKEN)).resolves.toEqual({ ok: false, error: MENSAJE_NO_DISPONIBLE })
  })
})
