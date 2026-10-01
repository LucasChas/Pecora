import { beforeEach, describe, expect, it, vi } from 'vitest'

// Cadena mínima de supabase.from(...): cada await consume la próxima respuesta.
const estado = vi.hoisted(() => ({
  respuestas: [] as { data: unknown; error: unknown }[],
  llamadas: [] as [string, unknown[]][],
}))
vi.mock('./supabaseClient', () => {
  const cadena: Record<string, unknown> = {}
  for (const m of ['select', 'update', 'eq', 'maybeSingle']) {
    cadena[m] = (...args: unknown[]) => {
      estado.llamadas.push([m, args])
      return cadena
    }
  }
  cadena.then = (ok: (v: unknown) => unknown, mal: (e: unknown) => unknown) =>
    Promise.resolve(estado.respuestas.shift()).then(ok, mal)
  return { supabase: { from: () => cadena } }
})

import { guardarProductoSinPisarStock, mensajeConflictoStock } from './stock'

beforeEach(() => {
  estado.respuestas = []
  estado.llamadas = []
})

describe('guardarProductoSinPisarStock', () => {
  it('si cambia el stock, el update es condicional al valor leído', async () => {
    estado.respuestas.push({ data: [{ id: 'p1' }], error: null })
    const r = await guardarProductoSinPisarStock('p1', { stock: 8 }, 5)
    expect(r).toEqual({ ok: true })
    expect(estado.llamadas).toContainEqual(['eq', ['stock', 5]])
  })

  it('si el stock no está en los cambios, no condiciona por stock', async () => {
    estado.respuestas.push({ data: [{ id: 'p1' }], error: null })
    await guardarProductoSinPisarStock('p1', { nombre: 'Body' }, 5)
    expect(estado.llamadas).not.toContainEqual(['eq', ['stock', 5]])
  })

  it('si entró una venta, devuelve conflicto con el stock real', async () => {
    estado.respuestas.push({ data: [], error: null }, { data: { stock: 3 }, error: null })
    const r = await guardarProductoSinPisarStock('p1', { stock: 8 }, 5)
    expect(r).toEqual({ ok: false, conflicto: true, stockActual: 3 })
  })

  it('0 filas con el mismo stock es falta de permiso, no conflicto', async () => {
    estado.respuestas.push({ data: [], error: null }, { data: { stock: 5 }, error: null })
    const r = await guardarProductoSinPisarStock('p1', { stock: 8 }, 5)
    expect(r).toMatchObject({ ok: false, conflicto: false })
  })

  it('propaga el error de la base', async () => {
    estado.respuestas.push({ data: null, error: { message: 'boom' } })
    const r = await guardarProductoSinPisarStock('p1', { stock: 8 }, 5)
    expect(r).toEqual({ ok: false, conflicto: false, error: 'boom' })
  })

  it('si el producto ya no existe lo dice', async () => {
    estado.respuestas.push({ data: [], error: null }, { data: null, error: null })
    const r = await guardarProductoSinPisarStock('p1', { stock: 8 }, 5)
    expect(r).toEqual({ ok: false, conflicto: false, error: 'El producto ya no existe.' })
  })
})

describe('mensajeConflictoStock', () => {
  it('explica cuántas unidades se vendieron', () => {
    expect(mensajeConflictoStock(5, 4)).toContain('se vendió 1 unidad')
    expect(mensajeConflictoStock(5, 2)).toContain('se vendieron 3 unidades')
    expect(mensajeConflictoStock(5, 2)).toContain('el stock ahora es 2')
  })

  it('si el stock subió, no habla de ventas', () => {
    expect(mensajeConflictoStock(2, 6)).toContain('alguien más lo modificó')
  })
})
