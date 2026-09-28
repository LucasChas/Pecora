import { describe, expect, it } from 'vitest'
import type { ProductoConCategoria } from '../types'
import { MAXIMO_RELACIONADOS, elegirRelacionados } from './relacionados'

// ---- Datos de prueba ---------------------------------------------------------

function producto(id: string, categoria_id: string | null, stock = 5): ProductoConCategoria {
  return {
    id,
    nombre: `Producto ${id}`,
    categoria_id,
    descripcion: null,
    precio: 1000,
    stock,
    imagen_url: null,
    slug: null,
    imagenes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    categoria_nombre: categoria_id ? `Cat ${categoria_id}` : null,
  }
}

const ids = (lista: ProductoConCategoria[]) => lista.map((p) => p.id)

// ---- Tests -------------------------------------------------------------------

describe('elegirRelacionados', () => {
  it('sin productos devuelve una lista vacía', () => {
    expect(elegirRelacionados(producto('actual', 'bodys'), [])).toEqual([])
  })

  it('si el único producto es el actual, no hay relacionados', () => {
    const actual = producto('actual', 'bodys')
    expect(elegirRelacionados(actual, [actual])).toEqual([])
  })

  it('nunca incluye el producto actual', () => {
    const actual = producto('actual', 'bodys')
    const todos = [actual, producto('b1', 'bodys'), producto('b2', 'bodys')]
    expect(ids(elegirRelacionados(actual, todos))).not.toContain('actual')
  })

  it('prioriza la misma categoría sobre las demás', () => {
    const actual = producto('actual', 'bodys')
    const todos = [
      producto('m1', 'mantas'),
      producto('b1', 'bodys'),
      producto('m2', 'mantas'),
      producto('b2', 'bodys'),
      actual,
    ]
    expect(ids(elegirRelacionados(actual, todos))).toEqual(['b1', 'b2'])
  })

  it('dentro de la categoría pone primero los disponibles y respeta el orden dado', () => {
    const actual = producto('actual', 'bodys')
    const todos = [
      producto('sin1', 'bodys', 0),
      producto('con1', 'bodys', 3),
      producto('sin2', 'bodys', 0),
      producto('con2', 'bodys', 1),
    ]
    expect(ids(elegirRelacionados(actual, todos))).toEqual(['con1', 'con2', 'sin1', 'sin2'])
  })

  it('stock negativo cuenta como no disponible', () => {
    const actual = producto('actual', 'bodys')
    const todos = [producto('neg', 'bodys', -2), producto('con', 'bodys', 1)]
    expect(ids(elegirRelacionados(actual, todos))).toEqual(['con', 'neg'])
  })

  it(`devuelve como máximo ${MAXIMO_RELACIONADOS}`, () => {
    const actual = producto('actual', 'bodys')
    const todos = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((id) => producto(id, 'bodys'))
    const elegidos = elegirRelacionados(actual, todos)
    expect(MAXIMO_RELACIONADOS).toBe(4)
    expect(ids(elegidos)).toEqual(['b1', 'b2', 'b3', 'b4'])
  })

  it('el tope de 4 se aplica después de ordenar por disponibilidad', () => {
    const actual = producto('actual', 'bodys')
    const todos = [
      producto('sin1', 'bodys', 0),
      producto('sin2', 'bodys', 0),
      producto('sin3', 'bodys', 0),
      producto('con1', 'bodys'),
      producto('con2', 'bodys'),
    ]
    expect(ids(elegirRelacionados(actual, todos))).toEqual(['con1', 'con2', 'sin1', 'sin2'])
  })

  it('con 2 o más de la misma categoría no completa con otras categorías', () => {
    const actual = producto('actual', 'bodys')
    const todos = [producto('b1', 'bodys', 0), producto('b2', 'bodys', 0), producto('m1', 'mantas')]
    expect(ids(elegirRelacionados(actual, todos))).toEqual(['b1', 'b2'])
  })

  it('con menos de 2 de la misma categoría completa con disponibles de otras', () => {
    const actual = producto('actual', 'bodys')
    const todos = [
      producto('m1', 'mantas'),
      producto('m2', 'mantas', 0), // sin stock: no entra como relleno
      producto('b1', 'bodys', 0), // de la categoría: entra aunque no haya stock
      producto('g1', 'gorros'),
      producto('g2', 'gorros'),
      producto('g3', 'gorros'),
    ]
    expect(ids(elegirRelacionados(actual, todos))).toEqual(['b1', 'm1', 'g1', 'g2'])
  })

  it('el relleno no repite un producto ya elegido de la categoría', () => {
    const actual = producto('actual', 'bodys')
    const todos = [producto('m1', 'mantas'), producto('b1', 'bodys'), producto('g1', 'gorros')]
    expect(ids(elegirRelacionados(actual, todos))).toEqual(['b1', 'm1', 'g1'])
  })

  it('sin otros de la categoría, todo sale del relleno disponible', () => {
    const actual = producto('actual', 'bodys')
    const todos = [actual, producto('m1', 'mantas', 0), producto('m2', 'mantas'), producto('s1', null)]
    expect(ids(elegirRelacionados(actual, todos))).toEqual(['m2', 's1'])
  })

  it('un producto sin categoría solo recibe relleno disponible', () => {
    const actual = producto('actual', null)
    const todos = [producto('s1', null, 0), producto('s2', null), producto('m1', 'mantas')]
    expect(ids(elegirRelacionados(actual, todos))).toEqual(['s2', 'm1'])
  })

  it('si no hay nada disponible para completar, devuelve solo lo de la categoría', () => {
    const actual = producto('actual', 'bodys')
    const todos = [producto('b1', 'bodys', 0), producto('m1', 'mantas', 0)]
    expect(ids(elegirRelacionados(actual, todos))).toEqual(['b1'])
  })

  it('no modifica la lista recibida', () => {
    const actual = producto('actual', 'bodys')
    const todos = [producto('sin', 'bodys', 0), producto('con', 'bodys')]
    const copia = [...todos]
    elegirRelacionados(actual, todos)
    expect(todos).toEqual(copia)
  })
})
