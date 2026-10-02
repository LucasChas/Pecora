import { describe, expect, it } from 'vitest'
import { aGuardar, firma, leerGuardados, rearmarCarrito } from './carritoRemoto'
import type { ProductoConCategoria } from '../types'

const item = (id: string, cantidad: number) => ({ id, nombre: id, precio: 10, imagen: '', stock: 5, cantidad })

describe('carritoRemoto', () => {
  it('aGuardar deja solo id y cantidad, sin duplicados', () => {
    expect(aGuardar([item('a', 2), item('a', 3), item('b', 0), item('c', 1)])).toEqual([
      { id: 'a', cantidad: 2 },
      { id: 'c', cantidad: 1 },
    ])
  })

  it('firma cambia con la cantidad', () => {
    expect(firma([{ id: 'a', cantidad: 1 }])).not.toBe(firma([{ id: 'a', cantidad: 2 }]))
    expect(firma([])).toBe('')
  })

  it('leerGuardados ignora basura', () => {
    expect(leerGuardados([{ id: 'a', cantidad: 2 }, { id: 3 }, null, { id: 'b', cantidad: -1 }])).toEqual([
      { id: 'a', cantidad: 2 },
    ])
    expect(leerGuardados('x')).toEqual([])
  })

  it('rearmarCarrito usa los datos actuales y saltea agotados', () => {
    const productos = [
      { id: 'a', nombre: 'Body', precio: 1200, stock: 1, slug: 'body', imagen_url: null, imagenes: [] },
      { id: 'b', nombre: 'Gorro', precio: 500, stock: 0, slug: null, imagen_url: null, imagenes: [] },
    ] as unknown as ProductoConCategoria[]
    const r = rearmarCarrito(
      [
        { id: 'a', cantidad: 3 },
        { id: 'b', cantidad: 1 },
        { id: 'zz', cantidad: 1 },
      ],
      productos,
    )
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ id: 'a', nombre: 'Body', precio: 1200, cantidad: 1, stock: 1, slug: 'body' })
  })
})

describe('carritoRemoto con talles', () => {
  it('guarda y rearma cada talle por separado', () => {
    const items = [
      { id: 'a', nombre: 'Body', precio: 10, imagen: '', stock: 2, cantidad: 1, talleId: 't1', talle: '0-3 m' },
      { id: 'a', nombre: 'Body', precio: 10, imagen: '', stock: 5, cantidad: 2, talleId: 't2', talle: '3-6 m' },
    ]
    const guardados = aGuardar(items)
    expect(guardados).toEqual([
      { id: 'a', cantidad: 1, talle_id: 't1' },
      { id: 'a', cantidad: 2, talle_id: 't2' },
    ])
    expect(leerGuardados(guardados)).toEqual(guardados)
    const productos = [
      {
        id: 'a', nombre: 'Body', precio: 10, stock: 1, slug: null, imagen_url: null, imagenes: [],
        talles: [
          { id: 't1', talle: '0-3 m', stock: 1, orden: 0 },
          { id: 't2', talle: '3-6 m', stock: 0, orden: 1 },
        ],
      },
    ] as unknown as ProductoConCategoria[]
    const r = rearmarCarrito([...guardados, { id: 'a', cantidad: 1 }], productos)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ talleId: 't1', talle: '0-3 m', stock: 1, cantidad: 1 })
  })
})
