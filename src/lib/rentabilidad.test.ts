import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabaseClient', () => ({ supabase: { rpc } }))

import {
  MENSAJE_FALTA_MIGRACION_RENTABILIDAD,
  cargarRentabilidad,
  completarMesesRentabilidad,
  describirErrorRentabilidad,
  margen,
  masRentable,
  masVendido,
  mejorMargen,
  mesSiguiente,
  normalizarRentabilidad,
  ordenarPorBeneficio,
  proyectarProximoMes,
  rangoMesesCompletos,
  sinDatosDeCosto,
  sinMovimiento,
  type RentabilidadMes,
  type RentabilidadProducto,
} from './rentabilidad'

function producto(p: Partial<RentabilidadProducto> & { producto_id: string }): RentabilidadProducto {
  return {
    nombre: p.producto_id,
    unidades_vendidas: 0,
    ingresos: 0,
    costo_unitario_estimado: null,
    costo_estimado: null,
    beneficio_estimado: null,
    margen: null,
    gastos_periodo: 0,
    ...p,
  }
}

function mes(m: string, ingresos: number, gastos: number): RentabilidadMes {
  return { mes: m, ingresos, gastos, beneficio: ingresos - gastos, margen: margen(ingresos - gastos, ingresos) }
}

describe('margen', () => {
  it('beneficio sobre ingresos con 1 decimal', () => {
    expect(margen(5400, 7100)).toBe(76.1)
    expect(margen(-550, 250)).toBe(-220)
  })
  it('sin ingresos no hay margen', () => {
    expect(margen(-100, 0)).toBeNull()
  })
})

describe('normalizarRentabilidad', () => {
  it('convierte montos en texto y respeta los null de la RPC', () => {
    const r = normalizarRentabilidad({
      por_mes: [
        { mes: '2026-02', ingresos: '2500', gastos: '800', beneficio: '1700', margen: '68.0' },
        { mes: '2026-01', ingresos: 7100, gastos: 1700, beneficio: 5400, margen: 76.1 },
        { mes: null },
      ],
      totales: { ingresos: '9600', gastos: '2500', beneficio: '7100', margen: 74, pedidos: 3 },
      productos: [
        {
          producto_id: 'p1',
          nombre: 'Babero',
          unidades_vendidas: 5,
          ingresos: '5000',
          costo_unitario_estimado: '90.00',
          costo_estimado: '450',
          beneficio_estimado: '4550',
          margen: 91,
          gastos_periodo: '1600',
        },
        { producto_id: 'p2', nombre: null, unidades_vendidas: 1, ingresos: 5000, costo_unitario_estimado: null },
        { nombre: 'sin id' },
      ],
      gastos_por_categoria: [
        { categoria: 'packaging', total: '300' },
        { categoria: 'materiales', total: 2000 },
        { categoria: 'inventada', total: 1 },
      ],
      gastos_generales: '450',
    })
    expect(r.por_mes.map((m) => m.mes)).toEqual(['2026-01', '2026-02'])
    expect(r.por_mes[1]).toEqual({ mes: '2026-02', ingresos: 2500, gastos: 800, beneficio: 1700, margen: 68 })
    expect(r.totales).toEqual({ ingresos: 9600, gastos: 2500, beneficio: 7100, margen: 74, pedidos: 3 })
    expect(r.productos).toHaveLength(2)
    expect(r.productos[0]).toMatchObject({ costo_unitario_estimado: 90, beneficio_estimado: 4550, margen: 91 })
    expect(r.productos[1]).toMatchObject({
      nombre: 'Producto eliminado',
      costo_unitario_estimado: null,
      beneficio_estimado: null,
      margen: null,
    })
    expect(r.gastos_por_categoria).toEqual([
      { categoria: 'materiales', total: 2000 },
      { categoria: 'packaging', total: 300 },
      { categoria: 'envios', total: 0 },
      { categoria: 'otros', total: 0 },
    ])
    expect(r.gastos_generales).toBe(450)
  })

  it('con null devuelve todo en cero', () => {
    const r = normalizarRentabilidad(null)
    expect(r.totales).toEqual({ ingresos: 0, gastos: 0, beneficio: 0, margen: null, pedidos: 0 })
    expect(r.gastos_por_categoria).toHaveLength(4)
    expect(sinMovimiento(r)).toBe(true)
  })

  it('sin totales, los calcula desde los meses', () => {
    const r = normalizarRentabilidad({ por_mes: [{ mes: '2026-01', ingresos: 1000, gastos: 400 }] })
    expect(r.por_mes[0]).toEqual({ mes: '2026-01', ingresos: 1000, gastos: 400, beneficio: 600, margen: 60 })
    expect(r.totales).toMatchObject({ ingresos: 1000, gastos: 400, beneficio: 600, margen: 60 })
  })
})

describe('completarMesesRentabilidad', () => {
  it('rellena con ceros', () => {
    expect(
      completarMesesRentabilidad([mes('2026-09', 100, 50)], { desde: '2026-08-01', hasta: '2026-09-28' }),
    ).toEqual([
      { mes: '2026-08', ingresos: 0, gastos: 0, beneficio: 0, margen: null },
      { mes: '2026-09', ingresos: 100, gastos: 50, beneficio: 50, margen: 50 },
    ])
  })
})

describe('estimaciones por producto', () => {
  const lista = [
    producto({ producto_id: 'manta', unidades_vendidas: 3, ingresos: 60000, costo_unitario_estimado: 8000, beneficio_estimado: 36000, margen: 60 }),
    producto({ producto_id: 'babero', unidades_vendidas: 10, ingresos: 65000, costo_unitario_estimado: 1300, beneficio_estimado: 52000, margen: 80 }),
    producto({ producto_id: 'chupete', unidades_vendidas: 10, ingresos: 49000, costo_unitario_estimado: 600, beneficio_estimado: 43000, margen: 87.8 }),
    producto({ producto_id: 'arrullo', unidades_vendidas: 12, ingresos: 300000 }),
    producto({ producto_id: 'sin-ventas', unidades_vendidas: 0, costo_unitario_estimado: 100, beneficio_estimado: 0 }),
  ]

  it('más vendido: por unidades, aunque no tenga costo', () => {
    expect(masVendido(lista)?.producto_id).toBe('arrullo')
  })
  it('más vendido: desempata por ingresos', () => {
    expect(masVendido(lista.filter((p) => p.producto_id !== 'arrullo'))?.producto_id).toBe('babero')
  })
  it('más rentable: mayor beneficio estimado, solo con costo', () => {
    expect(masRentable(lista)?.producto_id).toBe('babero')
  })
  it('mejor margen: mayor %, solo con costo y con ventas', () => {
    expect(mejorMargen(lista)?.producto_id).toBe('chupete')
  })
  it('marca los vendidos sin datos de costo', () => {
    expect(sinDatosDeCosto(lista).map((p) => p.producto_id)).toEqual(['arrullo'])
  })
  it('sin datos no inventa nada', () => {
    expect(masVendido([])).toBeNull()
    expect(masRentable([producto({ producto_id: 'x', unidades_vendidas: 2, ingresos: 10 })])).toBeNull()
    expect(mejorMargen([])).toBeNull()
  })
  it('ordena por beneficio, los sin costo al final por ingresos', () => {
    expect(ordenarPorBeneficio(lista).map((p) => p.producto_id)).toEqual([
      'babero',
      'chupete',
      'manta',
      'sin-ventas',
      'arrullo',
    ])
  })
})

describe('proyección', () => {
  const hoy = new Date(2026, 8, 28) // 28/09/2026

  it('rangoMesesCompletos: los 3 meses anteriores al actual', () => {
    expect(rangoMesesCompletos(hoy)).toEqual({ desde: '2026-06-01', hasta: '2026-08-31' })
    expect(rangoMesesCompletos(new Date(2026, 0, 5))).toEqual({ desde: '2025-10-01', hasta: '2025-12-31' })
  })
  it('mesSiguiente cruza el año', () => {
    expect(mesSiguiente(hoy)).toBe('2026-10')
    expect(mesSiguiente(new Date(2026, 11, 3))).toBe('2027-01')
  })
  it('promedia los últimos 3 meses completos e ignora el actual', () => {
    const p = proyectarProximoMes(
      [mes('2026-05', 999999, 0), mes('2026-06', 100000, 40000), mes('2026-07', 130000, 50000), mes('2026-08', 160000, 30000), mes('2026-09', 5000, 90000)],
      hoy,
    )
    expect(p).toEqual({ mes: '2026-10', ingresos: 130000, gastos: 40000, beneficio: 90000, mesesBase: 3 })
  })
  it('no cuenta los meses sin movimiento', () => {
    const p = proyectarProximoMes([mes('2026-06', 0, 0), mes('2026-07', 0, 0), mes('2026-08', 90000, 30000)], hoy)
    expect(p).toEqual({ mes: '2026-10', ingresos: 90000, gastos: 30000, beneficio: 60000, mesesBase: 1 })
  })
  it('sin datos no hay proyección', () => {
    expect(proyectarProximoMes([mes('2026-09', 100, 0)], hoy)).toBeNull()
    expect(proyectarProximoMes([], hoy)).toBeNull()
  })
})

describe('errores', () => {
  it('RPC inexistente → falta migración', () => {
    expect(describirErrorRentabilidad({ code: 'PGRST202', message: 'Could not find the function' })).toEqual({
      faltaMigracion: true,
      mensaje: MENSAJE_FALTA_MIGRACION_RENTABILIDAD,
    })
  })
  it('sin permiso', () => {
    expect(describirErrorRentabilidad({ code: '42501', message: 'No autorizado' }).mensaje).toMatch(/permiso/)
  })
  it('rango inválido: usa el mensaje de la base', () => {
    expect(describirErrorRentabilidad({ code: '22023', message: 'La fecha desde…' }).mensaje).toBe('La fecha desde…')
  })
})

describe('cargarRentabilidad', () => {
  const hoy = new Date(2026, 8, 28)

  beforeEach(() => {
    rpc.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('pide el rango y los 3 meses completos para la proyección', async () => {
    rpc.mockImplementation((_fn: string, args: { p_desde: string }) =>
      Promise.resolve({
        data:
          args.p_desde === '2026-06-01'
            ? { por_mes: [{ mes: '2026-08', ingresos: 3000, gastos: 1000 }] }
            : { totales: { ingresos: 10, gastos: 0 } },
        error: null,
      }),
    )
    const r = await cargarRentabilidad({ desde: '2026-09-01', hasta: '2026-09-28' }, hoy)
    expect(rpc).toHaveBeenCalledWith('rentabilidad', { p_desde: '2026-09-01', p_hasta: '2026-09-28' })
    expect(rpc).toHaveBeenCalledWith('rentabilidad', { p_desde: '2026-06-01', p_hasta: '2026-08-31' })
    expect(r.ok && r.datos.totales.ingresos).toBe(10)
    expect(r.ok && r.proyeccion).toEqual({ mes: '2026-10', ingresos: 3000, gastos: 1000, beneficio: 2000, mesesBase: 1 })
  })

  it('si falla solo la proyección, muestra el resto', async () => {
    rpc.mockImplementation((_fn: string, args: { p_desde: string }) =>
      args.p_desde === '2026-06-01'
        ? Promise.reject(new Error('Failed to fetch'))
        : Promise.resolve({ data: {}, error: null }),
    )
    const r = await cargarRentabilidad({ desde: '2026-09-01', hasta: '2026-09-28' }, hoy)
    expect(r.ok).toBe(true)
    expect(r.ok && r.proyeccion).toBeNull()
  })

  it('RPC faltante', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'x' } })
    expect(await cargarRentabilidad({ desde: '2026-09-01', hasta: '2026-09-28' }, hoy)).toEqual({
      ok: false,
      faltaMigracion: true,
      mensaje: MENSAJE_FALTA_MIGRACION_RENTABILIDAD,
    })
  })
})
