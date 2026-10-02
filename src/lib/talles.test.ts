import { describe, expect, it } from 'vitest'
import { filasDe, planTalles, stockTotal, validarFilas, type FilaTalle } from './talles'

const fila = (talle: string, stock: string, id?: string): FilaTalle => ({ key: id ?? talle, id, talle, stock })

describe('talles del panel', () => {
  it('valida nombres, repetidos y stock', () => {
    expect(validarFilas([])).toMatch(/al menos un talle/)
    expect(validarFilas([fila(' ', '1')])).toBe('Hay un talle sin nombre.')
    expect(validarFilas([fila('RN', '1'), fila('rn', '2')])).toBe('El talle "rn" está repetido.')
    expect(validarFilas([fila('RN', '-1')])).toMatch(/Revisá el stock/)
    expect(validarFilas([fila('RN', '1.5')])).toMatch(/Revisá el stock/)
    expect(validarFilas([fila('RN', '')])).toMatch(/Revisá el stock/)
    expect(validarFilas([fila('RN', '0'), fila('0-3 m', '4')])).toBeNull()
  })

  it('suma el stock', () => {
    expect(stockTotal([fila('a', '2'), fila('b', '3'), fila('c', '')])).toBe(5)
  })

  it('arma el plan: borrar, cambiar y crear', () => {
    const originales = [
      { id: 't1', talle: 'RN', stock: 2, orden: 0 },
      { id: 't2', talle: '0-3 m', stock: 1, orden: 1 },
      { id: 't3', talle: '3-6 m', stock: 0, orden: 2 },
    ]
    const plan = planTalles(originales, [
      fila('RN', '2', 't1'), // igual
      fila('3-6 m', '5', 't3'), // cambia stock y orden
      fila('6-9 m', '1'), // nuevo
    ])
    expect(plan.borrar).toEqual(['t2'])
    expect(plan.actualizar).toEqual([{ id: 't3', talle: '3-6 m', stock: 5, orden: 1, stockAntes: 0 }])
    expect(plan.crear).toEqual([{ talle: '6-9 m', stock: 1, orden: 2 }])
  })

  it('al duplicar copia los nombres sin ids ni stock', () => {
    const f = filasDe([{ id: 't1', talle: 'RN', stock: 2, orden: 0 }], false)
    expect(f[0].id).toBeUndefined()
    expect(f[0].stock).toBe('')
    expect(f[0].talle).toBe('RN')
  })
})
