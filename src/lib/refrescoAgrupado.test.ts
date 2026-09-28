import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crearDisparoAgrupado } from './productsCache'

describe('crearDisparoAgrupado', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('no ejecuta nada hasta que pasa la espera', () => {
    const accion = vi.fn()
    const d = crearDisparoAgrupado(accion, { espera: 800, esperaMaxima: 3000 })
    d.pedir()
    expect(d.pendiente()).toBe(true)
    vi.advanceTimersByTime(799)
    expect(accion).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(accion).toHaveBeenCalledTimes(1)
    expect(d.pendiente()).toBe(false)
  })

  it('una ráfaga de 20 avisos seguidos produce un solo refresco', () => {
    const accion = vi.fn()
    const d = crearDisparoAgrupado(accion, { espera: 800, esperaMaxima: 3000 })
    for (let i = 0; i < 20; i++) d.pedir()
    vi.advanceTimersByTime(800)
    expect(accion).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10_000)
    expect(accion).toHaveBeenCalledTimes(1)
  })

  it('cada aviso dentro de la espera la reinicia (trailing)', () => {
    const accion = vi.fn()
    const d = crearDisparoAgrupado(accion, { espera: 800, esperaMaxima: 3000 })
    d.pedir()
    vi.advanceTimersByTime(500)
    d.pedir()
    vi.advanceTimersByTime(500)
    expect(accion).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(accion).toHaveBeenCalledTimes(1)
  })

  it('una ráfaga continua no posterga más allá de la espera máxima', () => {
    const accion = vi.fn()
    const d = crearDisparoAgrupado(accion, { espera: 800, esperaMaxima: 3000 })
    // Un aviso cada 500 ms durante 5 s: sin tope nunca se ejecutaría.
    for (let t = 0; t < 5000; t += 500) {
      d.pedir()
      vi.advanceTimersByTime(500)
      if (t + 500 <= 2500) expect(accion).not.toHaveBeenCalled()
    }
    // A los 3 s del primer aviso corrió una vez; la ráfaga siguiente arranca de nuevo.
    expect(accion.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(accion.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('ejecuta exactamente al cumplirse la espera máxima', () => {
    const accion = vi.fn()
    const d = crearDisparoAgrupado(accion, { espera: 800, esperaMaxima: 3000 })
    d.pedir() // t=0
    for (let t = 700; t < 3000; t += 700) {
      vi.advanceTimersByTime(700)
      d.pedir()
    }
    // t=2800: el próximo disparo queda recortado a t=3000, no t=3600.
    vi.advanceTimersByTime(199)
    expect(accion).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(accion).toHaveBeenCalledTimes(1)
  })

  it('después de ejecutar, un aviso nuevo abre otra ráfaga', () => {
    const accion = vi.fn()
    const d = crearDisparoAgrupado(accion, { espera: 800, esperaMaxima: 3000 })
    d.pedir()
    vi.advanceTimersByTime(800)
    d.pedir()
    vi.advanceTimersByTime(800)
    expect(accion).toHaveBeenCalledTimes(2)
  })

  it('cancelar descarta lo pendiente (ej. al desmontar)', () => {
    const accion = vi.fn()
    const d = crearDisparoAgrupado(accion)
    d.pedir()
    d.cancelar()
    expect(d.pendiente()).toBe(false)
    vi.advanceTimersByTime(10_000)
    expect(accion).not.toHaveBeenCalled()
  })

  it('usa 800 ms / 3 s por defecto', () => {
    const accion = vi.fn()
    const d = crearDisparoAgrupado(accion)
    d.pedir()
    vi.advanceTimersByTime(799)
    expect(accion).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(accion).toHaveBeenCalledTimes(1)
  })
})
