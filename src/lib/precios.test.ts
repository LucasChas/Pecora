import { beforeEach, describe, expect, it, vi } from 'vitest'

const estado = vi.hoisted(() => ({
  respuesta: { data: null as unknown, error: null as unknown },
  args: null as unknown,
}))
vi.mock('./supabaseClient', () => ({
  supabase: {
    rpc: (_nombre: string, args: unknown) => {
      estado.args = args
      return Promise.resolve(estado.respuesta)
    },
  },
}))

import { ajustarPrecios, errorPorcentaje, porcentajeDe } from './precios'

beforeEach(() => {
  estado.respuesta = { data: null, error: null }
  estado.args = null
})

describe('errorPorcentaje', () => {
  it('acepta coma o punto decimal y valida el rango', () => {
    expect(errorPorcentaje('10')).toBeNull()
    expect(errorPorcentaje('-15,5')).toBeNull()
    expect(porcentajeDe('7,5')).toBe(7.5)
    expect(errorPorcentaje('')).toMatch(/porcentaje/)
    expect(errorPorcentaje('abc')).toMatch(/porcentaje/)
    expect(errorPorcentaje('0')).toMatch(/no cambia/)
    expect(errorPorcentaje('-95')).toMatch(/-90/)
    expect(errorPorcentaje('600')).toMatch(/500/)
  })
})

describe('ajustarPrecios', () => {
  it('manda los parámetros y convierte los montos a número', async () => {
    estado.respuesta = {
      data: { cambios: [{ id: 'p1', nombre: 'Body', antes: '1000', despues: '1100' }], cantidad: 1 },
      error: null,
    }
    const r = await ajustarPrecios({ porcentaje: 10, categoriaId: null, redondeo: 100 }, true)
    expect(estado.args).toEqual({ p_porcentaje: 10, p_categoria_id: null, p_redondeo: 100, p_simular: true })
    expect(r).toEqual({ cambios: [{ id: 'p1', nombre: 'Body', antes: 1000, despues: 1100 }] })
  })

  it('traduce los errores conocidos', async () => {
    estado.respuesta = { data: null, error: { code: 'PGRST202', message: 'x' } }
    expect(await ajustarPrecios({ porcentaje: 10, categoriaId: null, redondeo: 0 }, true)).toEqual({
      error: 'Falta aplicar la migración ajustar_precios en Supabase.',
    })
    estado.respuesta = { data: null, error: { code: '42501', message: 'x' } }
    expect(await ajustarPrecios({ porcentaje: 10, categoriaId: null, redondeo: 0 }, true)).toEqual({
      error: 'Tu cuenta no puede cambiar precios.',
    })
  })
})
