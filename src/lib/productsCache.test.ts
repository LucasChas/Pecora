import { describe, expect, it } from 'vitest'
import { crearCacheMonotona } from './productsCache'

describe('crearCacheMonotona', () => {
  it('arranca vacía', () => {
    const cache = crearCacheMonotona<string[]>()
    expect(cache.leer()).toBeNull()
  })

  it('numera los pedidos en orden creciente, compartido entre quienes la usan', () => {
    const cache = crearCacheMonotona<string[]>()
    const deA = cache.nuevoPedido()
    const deB = cache.nuevoPedido()
    const deA2 = cache.nuevoPedido()
    expect(deA).toBeLessThan(deB)
    expect(deB).toBeLessThan(deA2)
  })

  it('guarda la primera respuesta aunque sea de un pedido viejo', () => {
    const cache = crearCacheMonotona<string[]>()
    const viejo = cache.nuevoPedido()
    cache.nuevoPedido() // otro pedido en vuelo, todavía sin respuesta
    expect(cache.ofrecer(viejo, ['v1'])).toEqual(['v1'])
    expect(cache.leer()).toEqual(['v1'])
  })

  it('respuestas en orden: cada una reemplaza a la anterior', () => {
    const cache = crearCacheMonotona<string[]>()
    const p1 = cache.nuevoPedido()
    const p2 = cache.nuevoPedido()
    cache.ofrecer(p1, ['v1'])
    expect(cache.ofrecer(p2, ['v2'])).toEqual(['v2'])
    expect(cache.leer()).toEqual(['v2'])
  })

  it('una respuesta tardía de un pedido más viejo no pisa datos más nuevos', () => {
    // Instancia A (ej. muestrario que se desmontó) pide primero; instancia B
    // (ej. la ficha) pide después y su respuesta llega antes.
    const cache = crearCacheMonotona<string[]>()
    const deA = cache.nuevoPedido()
    const deB = cache.nuevoPedido()
    const nuevos = ['nuevo']
    expect(cache.ofrecer(deB, nuevos)).toBe(nuevos)

    const vigentes = cache.ofrecer(deA, ['viejo'])
    expect(vigentes).toBe(nuevos)
    expect(cache.leer()).toBe(nuevos)
  })

  it('al rechazar una respuesta vieja devuelve lo vigente para mostrarlo', () => {
    // Una instancia recibe la respuesta de SU último pedido, pero otra ya
    // guardó una lista más nueva: debe mostrar esa, no la suya.
    const cache = crearCacheMonotona<string[]>()
    const propio = cache.nuevoPedido()
    const ajeno = cache.nuevoPedido()
    cache.ofrecer(ajeno, ['de otra instancia'])
    expect(cache.ofrecer(propio, ['propio'])).toEqual(['de otra instancia'])
  })

  it('la misma respuesta ofrecida dos veces no cambia nada', () => {
    const cache = crearCacheMonotona<string[]>()
    const p1 = cache.nuevoPedido()
    const primera = ['a']
    cache.ofrecer(p1, primera)
    expect(cache.ofrecer(p1, ['a-duplicada'])).toBe(primera)
  })

  it('una lista vacía también es una respuesta válida y más nueva', () => {
    const cache = crearCacheMonotona<string[]>()
    const p1 = cache.nuevoPedido()
    const p2 = cache.nuevoPedido()
    cache.ofrecer(p1, ['a', 'b'])
    expect(cache.ofrecer(p2, [])).toEqual([])
    expect(cache.leer()).toEqual([])
  })

  it('cada caché lleva su propia numeración', () => {
    const una = crearCacheMonotona<string[]>()
    const otra = crearCacheMonotona<string[]>()
    una.nuevoPedido()
    una.nuevoPedido()
    const p = otra.nuevoPedido()
    otra.ofrecer(p, ['x'])
    expect(una.leer()).toBeNull()
    expect(otra.leer()).toEqual(['x'])
  })
})
