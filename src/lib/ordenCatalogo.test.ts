import { describe, expect, it } from 'vitest'
import { ordenDeUrl, ordenarCatalogo } from './ordenCatalogo'

const p = (id: string, precio: number, stock: number, created_at: string) => ({
  id,
  precio,
  stock,
  created_at,
})

const lista = [
  p('viejo-caro', 900, 2, '2026-01-01'),
  p('agotado-nuevo', 100, 0, '2026-09-01'),
  p('nuevo-barato', 200, 5, '2026-08-01'),
  p('agotado-viejo', 50, 0, '2026-02-01'),
]

describe('ordenarCatalogo', () => {
  it('novedades: más nuevos primero y los agotados al final', () => {
    expect(ordenarCatalogo(lista, 'novedades').map((x) => x.id)).toEqual([
      'nuevo-barato',
      'viejo-caro',
      'agotado-nuevo',
      'agotado-viejo',
    ])
  })

  it('por precio, también con los agotados al final', () => {
    expect(ordenarCatalogo(lista, 'precio-asc').map((x) => x.id)).toEqual([
      'nuevo-barato',
      'viejo-caro',
      'agotado-viejo',
      'agotado-nuevo',
    ])
    expect(ordenarCatalogo(lista, 'precio-desc').map((x) => x.id)[0]).toBe('viejo-caro')
  })

  it('no modifica la lista original', () => {
    const copia = [...lista]
    ordenarCatalogo(lista, 'precio-asc')
    expect(lista).toEqual(copia)
  })
})

describe('ordenDeUrl', () => {
  it('valores desconocidos caen en novedades', () => {
    expect(ordenDeUrl('precio-asc')).toBe('precio-asc')
    expect(ordenDeUrl('cualquiera')).toBe('novedades')
    expect(ordenDeUrl(null)).toBe('novedades')
  })
})
