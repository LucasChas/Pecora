import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabaseClient', () => ({ supabase: { rpc } }))

import {
  ENVIO_A_COORDINAR,
  cotizarEnvio,
  describirCobertura,
  parsearPrefijos,
  puedeCotizar,
  textoCotizacion,
  validarDatosZona,
  type DatosZona,
} from './envios'

const plano = (s: string) => s.replace(/\s/g, ' ')

describe('puedeCotizar', () => {
  it('hace falta provincia o un CP de 4+ dígitos', () => {
    expect(puedeCotizar('', '')).toBe(false)
    expect(puedeCotizar('', '50')).toBe(false)
    expect(puedeCotizar('', 'X5000')).toBe(true)
    expect(puedeCotizar('Córdoba', '')).toBe(true)
  })
})

describe('cotizarEnvio', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('zona con costo', async () => {
    rpc.mockResolvedValueOnce({
      data: { zona_id: 'z1', zona_nombre: 'Córdoba', costo: '2500.00', gratis: false, disponible: true, mensaje: null },
      error: null,
    })
    const c = await cotizarEnvio(' Córdoba ', '5000', 8000)
    expect(rpc).toHaveBeenCalledWith('cotizar_envio', { p_provincia: 'Córdoba', p_cp: '5000', p_subtotal: 8000 })
    expect(c).toEqual({ disponible: true, zonaId: 'z1', zonaNombre: 'Córdoba', costo: 2500, gratis: false, mensaje: null })
    expect(plano(textoCotizacion(c))).toBe('$ 2.500')
  })

  it('zona con envío gratis (arreglo de una fila)', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ zona_id: 'z1', zona_nombre: 'AMBA', costo: 3000, gratis: true, disponible: true }],
      error: null,
    })
    const c = await cotizarEnvio('Buenos Aires', '', 50000)
    expect(c.costo).toBe(0)
    expect(textoCotizacion(c)).toBe('Gratis')
  })

  it('sin zona que cubra el destino: a coordinar con el mensaje de la base', async () => {
    rpc.mockResolvedValueOnce({
      data: { disponible: false, mensaje: 'No llegamos a esa zona: lo coordinamos por WhatsApp.' },
      error: null,
    })
    const c = await cotizarEnvio('Jujuy', '', 1000)
    expect(c.disponible).toBe(false)
    expect(c.mensaje).toMatch(/WhatsApp/)
    expect(textoCotizacion(c)).toBe('A coordinar')
  })

  it('sin la migración, con error o excepción: a coordinar (sin romper)', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'no existe' } })
    await expect(cotizarEnvio('Córdoba', '', 1)).resolves.toEqual(ENVIO_A_COORDINAR)
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
    await expect(cotizarEnvio('Córdoba', '', 1)).resolves.toEqual(ENVIO_A_COORDINAR)
    rpc.mockRejectedValueOnce(new Error('boom'))
    await expect(cotizarEnvio('Córdoba', '', 1)).resolves.toEqual(ENVIO_A_COORDINAR)
    expect(aviso).toHaveBeenCalledTimes(1)
    aviso.mockRestore()
  })

  it('vacíos viajan como null', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    await cotizarEnvio('  ', '5000', 10)
    expect(rpc).toHaveBeenCalledWith('cotizar_envio', { p_provincia: null, p_cp: '5000', p_subtotal: 10 })
  })
})

describe('parsearPrefijos / describirCobertura', () => {
  it('solo dígitos, sin repetidos, separados por coma, punto y coma o espacio', () => {
    expect(parsearPrefijos('50, 51 ;5152  50, X, B1636')).toEqual(['50', '51', '5152', '1636'])
    expect(parsearPrefijos('')).toEqual([])
  })

  it('resume provincias y prefijos', () => {
    expect(describirCobertura({ provincias: ['Córdoba', 'Santa Fe'], cp_prefijos: ['50'] })).toBe(
      'Córdoba, Santa Fe · CP 50',
    )
    expect(describirCobertura({ provincias: [], cp_prefijos: [] })).toBe('Sin cobertura cargada')
  })
})

describe('validarDatosZona', () => {
  const ok: DatosZona = {
    nombre: 'AMBA',
    provincias: ['Buenos Aires'],
    cp_prefijos: [],
    precio: 3000,
    gratis_desde: null,
    activo: true,
    orden: 0,
  }

  it('acepta datos válidos y exige cobertura, nombre y montos coherentes', () => {
    expect(validarDatosZona(ok)).toBeNull()
    expect(validarDatosZona({ ...ok, nombre: ' ' })).toMatch(/nombre/)
    expect(validarDatosZona({ ...ok, provincias: [] })).toMatch(/provincia/)
    expect(validarDatosZona({ ...ok, precio: -1 })).toMatch(/negativo/)
    expect(validarDatosZona({ ...ok, gratis_desde: 0 })).toMatch(/mayor a 0/)
  })
})
