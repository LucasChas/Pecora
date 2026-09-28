import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabaseClient', () => ({ supabase: { rpc } }))

import {
  MENSAJE_FALTA_MIGRACION_ESTADISTICAS,
  cargarEstadisticas,
  completarMeses,
  describirErrorEstadisticas,
  etiquetaMes,
  fechaISO,
  mesesEntre,
  normalizarEstadisticas,
  porcentaje,
  rangoDePeriodo,
  sinDatos,
  validarRango,
} from './estadisticas'

describe('rangoDePeriodo', () => {
  const hoy = new Date(2026, 8, 28) // 28/09/2026

  it('este mes', () => {
    expect(rangoDePeriodo('este-mes', hoy)).toEqual({ desde: '2026-09-01', hasta: '2026-09-28' })
  })
  it('mes pasado (completo)', () => {
    expect(rangoDePeriodo('mes-pasado', hoy)).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' })
  })
  it('mes pasado en enero cruza el año', () => {
    expect(rangoDePeriodo('mes-pasado', new Date(2026, 0, 10))).toEqual({
      desde: '2025-12-01',
      hasta: '2025-12-31',
    })
  })
  it('últimos 3 meses incluye el actual', () => {
    expect(rangoDePeriodo('ultimos-3', hoy)).toEqual({ desde: '2026-07-01', hasta: '2026-09-28' })
    expect(rangoDePeriodo('ultimos-3', new Date(2026, 1, 3)).desde).toBe('2025-12-01')
  })
  it('este año', () => {
    expect(rangoDePeriodo('este-anio', hoy)).toEqual({ desde: '2026-01-01', hasta: '2026-09-28' })
  })
  it('fechaISO usa hora local con ceros', () => {
    expect(fechaISO(new Date(2026, 2, 5))).toBe('2026-03-05')
  })
})

describe('validarRango', () => {
  it('pide ambas fechas', () => {
    expect(validarRango('', '2026-01-01')).toMatch(/dos fechas/)
  })
  it('rechaza fechas imposibles', () => {
    expect(validarRango('2026-02-30', '2026-03-01')).toMatch(/no es válida/)
  })
  it('rechaza desde > hasta', () => {
    expect(validarRango('2026-05-01', '2026-04-01')).toMatch(/anterior/)
  })
  it('acepta un rango válido (incluso de un día)', () => {
    expect(validarRango('2026-04-01', '2026-04-01')).toBeNull()
  })
})

describe('meses', () => {
  it('mesesEntre cruza años', () => {
    expect(mesesEntre('2025-11-15', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })
  it('completarMeses rellena con ceros y ordena', () => {
    const r = completarMeses([{ mes: '2026-09', pedidos: 2, total: 500 }], {
      desde: '2026-07-01',
      hasta: '2026-09-28',
    })
    expect(r).toEqual([
      { mes: '2026-07', pedidos: 0, total: 0 },
      { mes: '2026-08', pedidos: 0, total: 0 },
      { mes: '2026-09', pedidos: 2, total: 500 },
    ])
  })
  it('etiquetaMes corta y larga', () => {
    expect(etiquetaMes('2026-09')).toBe('sep 26')
    expect(etiquetaMes('2026-01', true)).toBe('enero 2026')
    expect(etiquetaMes('basura')).toBe('basura')
  })
  it('porcentaje sin dividir por cero', () => {
    expect(porcentaje(1, 3)).toBe(33)
    expect(porcentaje(5, 0)).toBe(0)
    expect(porcentaje(0, 10)).toBe(0)
  })
})

describe('normalizarEstadisticas', () => {
  it('convierte montos en texto y completa la forma', () => {
    const e = normalizarEstadisticas({
      ventas_por_mes: [
        { mes: '2026-09', pedidos: '3', total: '1500.50' },
        { mes: '2026-08', pedidos: 1, total: 200 },
        { mes: null },
      ],
      total_periodo: '1700.5',
      pedidos_periodo: 4,
      mas_vendidos: [{ producto_id: 'a', nombre: 'Vela', unidades: '7', importe: '700' }],
      clientas_nuevas: 2,
      clientas_con_compra: '3',
      por_origen: { checkout: { pedidos: 3, total: '1500.5' } },
    })
    expect(e.ventas_por_mes.map((v) => v.mes)).toEqual(['2026-08', '2026-09'])
    expect(e.ventas_por_mes[1]).toEqual({ mes: '2026-09', pedidos: 3, total: 1500.5 })
    expect(e.total_periodo).toBe(1700.5)
    expect(e.ticket_promedio).toBeCloseTo(425.125)
    expect(e.mas_vendidos[0]).toEqual({ producto_id: 'a', nombre: 'Vela', unidades: 7, importe: 700 })
    expect(e.clientas_con_compra).toBe(3)
    expect(e.por_origen).toEqual({ checkout: { pedidos: 3, total: 1500.5 }, admin: { pedidos: 0, total: 0 } })
  })

  it('con null devuelve todo en cero', () => {
    const e = normalizarEstadisticas(null)
    expect(e.ventas_por_mes).toEqual([])
    expect(e.ticket_promedio).toBe(0)
    expect(sinDatos(e)).toBe(true)
  })

  it('producto sin nombre (borrado) queda identificable', () => {
    const e = normalizarEstadisticas({ mas_vendidos: [{ producto_id: 'x', nombre: null, unidades: 1 }] })
    expect(e.mas_vendidos[0].nombre).toBe('Producto eliminado')
  })
})

describe('errores', () => {
  it('RPC inexistente → falta migración', () => {
    expect(describirErrorEstadisticas({ code: 'PGRST202', message: 'Could not find the function' })).toEqual({
      faltaMigracion: true,
      mensaje: MENSAJE_FALTA_MIGRACION_ESTADISTICAS,
    })
  })
  it('sin permiso', () => {
    expect(describirErrorEstadisticas({ code: '42501', message: 'no autorizado' }).mensaje).toMatch(/permiso/)
  })
  it('red', () => {
    expect(describirErrorEstadisticas({ message: 'Failed to fetch' }).mensaje).toMatch(/conexión/)
  })
})

describe('cargarEstadisticas', () => {
  beforeEach(() => {
    rpc.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('llama a la RPC con el rango y normaliza', async () => {
    rpc.mockResolvedValue({ data: { total_periodo: 10, pedidos_periodo: 1 }, error: null })
    const r = await cargarEstadisticas({ desde: '2026-09-01', hasta: '2026-09-28' })
    expect(rpc).toHaveBeenCalledWith('estadisticas', { p_desde: '2026-09-01', p_hasta: '2026-09-28' })
    expect(r.ok && r.datos.total_periodo).toBe(10)
  })

  it('RPC faltante', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'x' } })
    expect(await cargarEstadisticas({ desde: '2026-09-01', hasta: '2026-09-28' })).toEqual({
      ok: false,
      faltaMigracion: true,
      mensaje: MENSAJE_FALTA_MIGRACION_ESTADISTICAS,
    })
  })

  it('excepción de red', async () => {
    rpc.mockRejectedValue(new Error('Failed to fetch'))
    const r = await cargarEstadisticas({ desde: '2026-09-01', hasta: '2026-09-28' })
    expect(r.ok).toBe(false)
  })
})
