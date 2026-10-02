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
