import { describe, expect, it } from 'vitest'
import { esAdmin, esStaff, permisosDe } from './roles'

describe('roles', () => {
  it('esStaff / esAdmin', () => {
    expect(esStaff({ rol: 'admin' })).toBe(true)
    expect(esStaff({ rol: 'empleado' })).toBe(true)
    expect(esStaff({ rol: 'cliente' })).toBe(false)
    expect(esStaff(null)).toBe(false)
    expect(esStaff({ rol: 'otro' })).toBe(false)
    expect(esAdmin({ rol: 'admin' })).toBe(true)
    expect(esAdmin({ rol: 'empleado' })).toBe(false)
    expect(esAdmin(undefined)).toBe(false)
  })

  it('matriz de permisos', () => {
    expect(permisosDe({ rol: 'admin' })).toEqual({
      panel: true,
      productos: true,
      pedidos: true,
      borrarPedidoDefinitivo: true,
      ajustes: true,
      estadisticas: true,
      equipo: true,
    })
    expect(permisosDe({ rol: 'empleado' })).toEqual({
      panel: true,
      productos: true,
      pedidos: true,
      borrarPedidoDefinitivo: false,
      ajustes: false,
      estadisticas: false,
      equipo: false,
    })
    expect(Object.values(permisosDe({ rol: 'cliente' })).every((v) => v === false)).toBe(true)
    expect(Object.values(permisosDe(null)).every((v) => v === false)).toBe(true)
  })
})
