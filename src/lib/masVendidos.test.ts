import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabaseClient', () => ({ supabase: { rpc } }))

import {
  CLAVE_CACHE_MAS_VENDIDOS,
  TTL_MAS_VENDIDOS_MS,
  cargarMasVendidos,
  guardarCacheMasVendidos,
  leerCacheMasVendidos,
  normalizarMasVendidos,
  resolverMasVendidos,
  type AlmacenSimple,
} from './masVendidos'
import type { ProductoConCategoria } from '../types'

function producto(id: string, stock = 5): ProductoConCategoria {
  return {
    id,
    nombre: `Producto ${id}`,
    categoria_id: null,
    categoria_nombre: null,
    descripcion: null,
    precio: 1000,
    stock,
    imagen_url: null,
    slug: id,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function almacenEnMemoria(): AlmacenSimple & { datos: Map<string, string> } {
  const datos = new Map<string, string>()
  return {
    datos,
    getItem: (k) => datos.get(k) ?? null,
    setItem: (k, v) => {
      datos.set(k, v)
    },
  }
}

describe('normalizarMasVendidos', () => {
  it('se queda con filas válidas, sin repetir y con unidades numéricas', () => {
    expect(
      normalizarMasVendidos([
        { producto_id: 'a', unidades: 10 },
        { producto_id: 'b', unidades: '4' },
        { producto_id: 'a', unidades: 3 },
        { producto_id: '', unidades: 1 },
        null,
        { unidades: 2 },
      ]),
    ).toEqual([
      { producto_id: 'a', unidades: 10 },
      { producto_id: 'b', unidades: 4 },
    ])
  })

  it('devuelve vacío si no es un arreglo', () => {
    expect(normalizarMasVendidos(null)).toEqual([])
    expect(normalizarMasVendidos({ producto_id: 'a' })).toEqual([])
  })
})

describe('resolverMasVendidos', () => {
  const ranking = ['a', 'b', 'c', 'd'].map((id) => ({ producto_id: id, unidades: 1 }))

  it('respeta el orden del ranking y descarta los que ya no existen', () => {
    const r = resolverMasVendidos(ranking, [producto('d'), producto('a'), producto('c')])
    expect(r.map((p) => p.id)).toEqual(['a', 'c', 'd'])
  })

  it('manda al final los que están sin stock', () => {
    const r = resolverMasVendidos(ranking, [
      producto('a', 0),
      producto('b'),
      producto('c', 0),
      producto('d'),
    ])
    expect(r.map((p) => p.id)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('corta en el límite', () => {
    const productos = ['a', 'b', 'c', 'd'].map((id) => producto(id))
    expect(resolverMasVendidos(ranking, productos, 2).map((p) => p.id)).toEqual(['a', 'b'])
  })
})

describe('caché de sesión', () => {
  const filas = [{ producto_id: 'a', unidades: 3 }]

  it('devuelve lo guardado dentro del TTL', () => {
    const almacen = almacenEnMemoria()
    guardarCacheMasVendidos(almacen, filas, 1000)
    expect(leerCacheMasVendidos(almacen, 1000 + TTL_MAS_VENDIDOS_MS)).toEqual(filas)
  })

  it('vence pasado el TTL', () => {
    const almacen = almacenEnMemoria()
    guardarCacheMasVendidos(almacen, filas, 1000)
    expect(leerCacheMasVendidos(almacen, 1001 + TTL_MAS_VENDIDOS_MS)).toBeNull()
  })

  it('ignora entradas corruptas o del futuro', () => {
    const almacen = almacenEnMemoria()
    almacen.setItem(CLAVE_CACHE_MAS_VENDIDOS, '{no es json')
    expect(leerCacheMasVendidos(almacen, 0)).toBeNull()
    guardarCacheMasVendidos(almacen, filas, 5000)
    expect(leerCacheMasVendidos(almacen, 1000)).toBeNull()
  })

  it('no rompe si el storage tira error o no existe', () => {
    const roto: AlmacenSimple = {
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => {
        throw new Error('lleno')
      },
    }
    expect(() => guardarCacheMasVendidos(roto, filas, 0)).not.toThrow()
    expect(leerCacheMasVendidos(roto, 0)).toBeNull()
    expect(leerCacheMasVendidos(null, 0)).toBeNull()
  })
})

describe('cargarMasVendidos', () => {
  beforeEach(() => {
    rpc.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('pide la RPC con límite y días y guarda en caché', async () => {
    rpc.mockResolvedValue({ data: [{ producto_id: 'a', unidades: 2 }], error: null })
    const almacen = almacenEnMemoria()
    const r = await cargarMasVendidos(almacen)
    expect(rpc).toHaveBeenCalledWith('mas_vendidos', { p_limite: 8, p_dias: 90 })
    expect(r).toEqual({ ok: true, filas: [{ producto_id: 'a', unidades: 2 }] })
    expect(almacen.datos.has(CLAVE_CACHE_MAS_VENDIDOS)).toBe(true)
  })

  it('usa la caché vigente sin llamar a la RPC', async () => {
    const almacen = almacenEnMemoria()
    guardarCacheMasVendidos(almacen, [{ producto_id: 'z', unidades: 1 }], Date.now())
    const r = await cargarMasVendidos(almacen)
    expect(rpc).not.toHaveBeenCalled()
    expect(r).toEqual({ ok: true, filas: [{ producto_id: 'z', unidades: 1 }] })
  })

  it('con la RPC inexistente devuelve ok:false y no guarda nada', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    const almacen = almacenEnMemoria()
    expect(await cargarMasVendidos(almacen)).toEqual({ ok: false })
    expect(almacen.datos.size).toBe(0)
  })

  it('un error de red no rompe', async () => {
    rpc.mockRejectedValue(new Error('Failed to fetch'))
    expect(await cargarMasVendidos(almacenEnMemoria())).toEqual({ ok: false })
  })

  it('comparte el pedido en vuelo', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    const [a, b] = await Promise.all([cargarMasVendidos(null), cargarMasVendidos(null)])
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
  })
})
