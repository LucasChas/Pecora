import { describe, expect, it } from 'vitest'
import { armarRecompra, mensajeRecompra, pasosPedido } from './pedidoCliente'
import type { ProductoConCategoria } from '../types'

const prod = (id: string, stock: number) => ({ id, nombre: id, stock, precio: 100 }) as unknown as ProductoConCategoria

describe('pasosPedido', () => {
  it('con envío: recibido → confirmado → enviado → entregado', () => {
    expect(pasosPedido('enviado', 'envio')?.map((p) => [p.texto, p.estado])).toEqual([
      ['Recibido', 'hecho'],
      ['Confirmado', 'hecho'],
      ['Enviado', 'actual'],
      ['Entregado', 'pendiente'],
    ])
  })

  it('a coordinar no tiene "Enviado" y termina en "Retirado"', () => {
    expect(pasosPedido('nuevo', 'coordinar')?.map((p) => p.texto)).toEqual(['Recibido', 'Confirmado', 'Retirado'])
    expect(pasosPedido('nuevo', 'coordinar')?.[0].estado).toBe('actual')
  })

  it('entregado: todos los pasos hechos', () => {
    expect(pasosPedido('entregado', 'envio')?.every((p) => p.estado === 'hecho')).toBe(true)
  })

  it('a coordinar marcado "enviado" se ve como confirmado; cancelado no tiene línea', () => {
    expect(pasosPedido('enviado', 'coordinar')?.find((p) => p.estado === 'actual')?.texto).toBe('Confirmado')
    expect(pasosPedido('cancelado', 'envio')).toBeNull()
  })
})

describe('armarRecompra', () => {
  it('agrega lo que tiene stock (sumando repetidos) y lista lo que no', () => {
    const r = armarRecompra(
      [
        { id: 'a', nombre: 'Body', cantidad: 2 },
        { id: 'a', nombre: 'Body', cantidad: 1 },
        { id: 'b', nombre: 'Gorro', cantidad: 1 },
        { id: 'c', nombre: 'Manta vieja', cantidad: 1 },
      ],
      [prod('a', 5), prod('b', 0)],
    )
    expect(r.agregar.map((x) => [x.producto.id, x.cantidad])).toEqual([['a', 3]])
    expect(r.noDisponibles).toEqual(['Gorro', 'Manta vieja'])
    expect(mensajeRecompra(r)).toBe('Agregamos 1 producto al carrito. 2 productos no tienen stock ahora.')
  })

  it('mensajes', () => {
    expect(mensajeRecompra({ agregar: [], noDisponibles: ['Gorro'] })).toBe('Ninguno de estos productos tiene stock ahora.')
    expect(mensajeRecompra(armarRecompra([{ id: 'a', nombre: 'Body', cantidad: 1 }, { id: 'b', nombre: 'Gorro', cantidad: 1 }], [prod('a', 1), prod('b', 2)]))).toBe(
      'Agregamos 2 productos al carrito.',
    )
  })
})
