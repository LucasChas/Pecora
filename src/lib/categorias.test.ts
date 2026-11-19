import { beforeEach, describe, expect, it, vi } from 'vitest'

// Cliente de Supabase falso que registra cada llamada encadenada.
const llamadas = vi.hoisted(() => [] as { tabla: string; op: string; args: unknown[] }[])
const respuestas = vi.hoisted(() => [] as { error: { code?: string; message: string } | null }[])
vi.mock('./supabaseClient', () => {
  const from = (tabla: string) => {
    const registro = (op: string) => (...args: unknown[]) => {
      llamadas.push({ tabla, op, args })
      return cadena
    }
    const cadena: Record<string, unknown> = {
      insert: registro('insert'),
      update: registro('update'),
      delete: registro('delete'),
      eq: registro('eq'),
      then: (ok: (v: unknown) => unknown) => ok(respuestas.shift() ?? { error: null }),
    }
    return cadena
  }
  return { supabase: { from } }
})

import { contarPorCategoria, crearCategoria, eliminarCategoria, limpiarNombre, renombrarCategoria } from './categorias'

beforeEach(() => {
  llamadas.length = 0
  respuestas.length = 0
})

describe('limpiarNombre', () => {
  it('saca espacios de más', () => {
    expect(limpiarNombre('  Mordillos   y  Sonajeros ')).toBe('Mordillos y Sonajeros')
  })
})

describe('crearCategoria / renombrarCategoria', () => {
  it('no manda nada si el nombre está vacío', async () => {
    expect(await crearCategoria('   ')).toMatch(/Escribí un nombre/)
    expect(await renombrarCategoria('c1', '')).toMatch(/vacío/)
    expect(llamadas).toHaveLength(0)
  })

  it('avisa si el nombre ya existe', async () => {
    respuestas.push({ error: { code: '23505', message: 'duplicate key' } })
    expect(await crearCategoria('Baberos')).toBe('Ya existe una categoría "Baberos".')
  })

  it('renombra con el nombre limpio', async () => {
    expect(await renombrarCategoria('c1', ' Sets  regalo ')).toBeNull()
    expect(llamadas).toEqual([
      { tabla: 'categorias', op: 'update', args: [{ nombre: 'Sets regalo' }] },
      { tabla: 'categorias', op: 'eq', args: ['id', 'c1'] },
    ])
  })
})

describe('eliminarCategoria', () => {
  it('sin productos: borra directo', async () => {
    expect(await eliminarCategoria('c1', { cantidadProductos: 0 })).toBeNull()
    expect(llamadas.map((l) => `${l.tabla}.${l.op}`)).toEqual(['categorias.delete', 'categorias.eq'])
  })

  it('con productos: exige destino y no toca nada sin él', async () => {
    expect(await eliminarCategoria('c1', { cantidadProductos: 3 })).toMatch(/Elegí a qué categoría/)
    expect(await eliminarCategoria('c1', { cantidadProductos: 3, moverA: 'c1' })).toMatch(/distinta/)
    expect(llamadas).toHaveLength(0)
  })

  it('con productos: primero los mueve y después borra', async () => {
    expect(await eliminarCategoria('c1', { cantidadProductos: 3, moverA: 'c2' })).toBeNull()
    expect(llamadas).toEqual([
      { tabla: 'productos', op: 'update', args: [{ categoria_id: 'c2' }] },
      { tabla: 'productos', op: 'eq', args: ['categoria_id', 'c1'] },
      { tabla: 'categorias', op: 'delete', args: [] },
      { tabla: 'categorias', op: 'eq', args: ['id', 'c1'] },
    ])
  })

  it('si mover falla, no intenta borrar', async () => {
    respuestas.push({ error: { message: 'permiso denegado' } })
    expect(await eliminarCategoria('c1', { cantidadProductos: 2, moverA: 'c2' })).toBe(
      'No se pudieron mover los productos: permiso denegado',
    )
    expect(llamadas.some((l) => l.op === 'delete')).toBe(false)
  })
})

describe('contarPorCategoria', () => {
  it('cuenta por id e ignora productos sin categoría', () => {
    const c = contarPorCategoria([{ categoria_id: 'a' }, { categoria_id: 'a' }, { categoria_id: 'b' }, { categoria_id: null }])
    expect(c.get('a')).toBe(2)
    expect(c.get('b')).toBe(1)
    expect(c.size).toBe(2)
  })
})
