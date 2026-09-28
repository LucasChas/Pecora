import { beforeEach, describe, expect, it, vi } from 'vitest'

// Cadena mínima de supabase.from(...) que resuelve con `respuesta`.
const estado = vi.hoisted(() => ({
  respuesta: { data: null as unknown, error: null as unknown },
  llamadas: [] as [string, unknown[]][],
}))
vi.mock('./supabaseClient', () => {
  const cadena: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'gte', 'lte', 'order']) {
    cadena[m] = (...args: unknown[]) => {
      estado.llamadas.push([m, args])
      return cadena
    }
  }
  cadena.then = (ok: (v: unknown) => unknown, mal: (e: unknown) => unknown) =>
    Promise.resolve(estado.respuesta).then(ok, mal)
  return { supabase: { from: () => cadena } }
})

import {
  MENSAJE_FALTA_MIGRACION_GASTOS,
  borrarGasto,
  costoPorUnidad,
  filaDeGasto,
  guardarGasto,
  listarGastos,
  mensajeErrorGasto,
  normalizarGasto,
  totalGastos,
  validarDatosGasto,
  type DatosGasto,
} from './gastos'

const base: DatosGasto = {
  fecha: '2026-09-10',
  concepto: 'Muselina',
  categoria: 'materiales',
  monto: 42000,
  producto_id: 'p1',
  cantidad: 8,
  notas: null,
}

describe('validarDatosGasto', () => {
  it('acepta un gasto completo y uno general', () => {
    expect(validarDatosGasto(base)).toBeNull()
    expect(validarDatosGasto({ ...base, producto_id: null, cantidad: null })).toBeNull()
  })
  it('fecha inválida', () => {
    expect(validarDatosGasto({ ...base, fecha: '2026-02-30' })).toMatch(/fecha/)
  })
  it('concepto obligatorio y con tope', () => {
    expect(validarDatosGasto({ ...base, concepto: '   ' })).toMatch(/concepto/)
    expect(validarDatosGasto({ ...base, concepto: 'a'.repeat(201) })).toMatch(/200/)
  })
  it('monto mayor a 0', () => {
    expect(validarDatosGasto({ ...base, monto: 0 })).toMatch(/mayor a 0/)
    expect(validarDatosGasto({ ...base, monto: NaN })).toMatch(/mayor a 0/)
  })
  it('cantidad entera, mayor a 0 y solo con producto', () => {
    expect(validarDatosGasto({ ...base, cantidad: 0 })).toMatch(/entero/)
    expect(validarDatosGasto({ ...base, cantidad: 1.5 })).toMatch(/entero/)
    expect(validarDatosGasto({ ...base, producto_id: null })).toMatch(/producto/)
  })
  it('categoría conocida', () => {
    expect(validarDatosGasto({ ...base, categoria: 'comida' as never })).toMatch(/categoría/)
  })
})

describe('cálculos', () => {
  it('costo por unidad', () => {
    expect(costoPorUnidad(42000, 8)).toBe(5250)
    expect(costoPorUnidad(42000, null)).toBeNull()
    expect(costoPorUnidad(0, 3)).toBeNull()
  })
  it('total', () => {
    expect(totalGastos([{ monto: 10.5 }, { monto: 4.5 }])).toBe(15)
  })
  it('filaDeGasto recorta y descarta la cantidad sin producto', () => {
    expect(filaDeGasto({ ...base, concepto: '  Tela ', notas: '  ', producto_id: null, monto: 10.006 })).toEqual({
      ...base,
      concepto: 'Tela',
      notas: null,
      producto_id: null,
      cantidad: null,
      monto: 10.01,
    })
  })
})

describe('normalizarGasto', () => {
  it('convierte montos y lee el producto embebido', () => {
    expect(
      normalizarGasto({
        id: 'g1',
        fecha: '2026-09-10',
        concepto: 'Tela',
        categoria: 'materiales',
        monto: '42000.00',
        producto_id: 'p1',
        cantidad: 8,
        notas: '',
        created_at: 'x',
        producto: { nombre: 'Manta' },
      }),
    ).toEqual({
      id: 'g1',
      fecha: '2026-09-10',
      concepto: 'Tela',
      categoria: 'materiales',
      monto: 42000,
      producto_id: 'p1',
      producto_nombre: 'Manta',
      cantidad: 8,
      notas: null,
      created_at: 'x',
    })
  })
  it('sin id no es un gasto; categoría desconocida cae en otros', () => {
    expect(normalizarGasto({ concepto: 'x' })).toBeNull()
    expect(normalizarGasto({ id: 'g', categoria: '??', producto: null })).toMatchObject({
      categoria: 'otros',
      producto_nombre: null,
      cantidad: null,
    })
  })
})

describe('acceso a datos', () => {
  beforeEach(() => {
    estado.llamadas = []
    estado.respuesta = { data: null, error: null }
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('listarGastos filtra por el rango', async () => {
    estado.respuesta = { data: [{ id: 'g1', monto: '5' }], error: null }
    const r = await listarGastos({ desde: '2026-09-01', hasta: '2026-09-28' })
    expect(r.ok && r.datos[0].monto).toBe(5)
    expect(estado.llamadas).toContainEqual(['gte', ['fecha', '2026-09-01']])
    expect(estado.llamadas).toContainEqual(['lte', ['fecha', '2026-09-28']])
  })

  it('listarGastos sin la tabla → falta migración', async () => {
    estado.respuesta = { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }
    expect(await listarGastos({ desde: '2026-09-01', hasta: '2026-09-28' })).toEqual({
      ok: false,
      faltaMigracion: true,
      mensaje: MENSAJE_FALTA_MIGRACION_GASTOS,
    })
  })

  it('guardar o borrar sin filas afectadas avisa (RLS no da error)', async () => {
    estado.respuesta = { data: [], error: null }
    expect(await guardarGasto(base, 'g1')).toMatch(/No se pudo guardar/)
    expect(await borrarGasto('g1')).toMatch(/No se pudo borrar/)
  })

  it('guardar ok', async () => {
    estado.respuesta = { data: [{ id: 'g1' }], error: null }
    expect(await guardarGasto(base)).toBeNull()
  })

  it('mensajes de error', () => {
    expect(mensajeErrorGasto({ code: '23514', message: 'check' })).toMatch(/fuera de rango/)
    expect(mensajeErrorGasto({ code: '42501', message: 'rls' })).toMatch(/permiso/)
    expect(mensajeErrorGasto({ code: '42P01', message: 'x' })).toBe(MENSAJE_FALTA_MIGRACION_GASTOS)
  })
})
