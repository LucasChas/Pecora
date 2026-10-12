import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  esMedioPago,
  etiquetaFeria,
  etiquetaMedioPago,
  fechaCortaFeria,
  guardarPreferenciasVenta,
  hoyISO,
  leerPreferenciasVenta,
  normalizarNombreFeria,
  ordenarFerias,
  validarNuevaFeria,
} from './ferias'

describe('fechas y etiquetas', () => {
  it('muestra el día de la semana y la fecha corta', () => {
    expect(fechaCortaFeria('2026-10-10')).toBe('sáb 10/10')
    expect(fechaCortaFeria('2026-01-05')).toBe('lun 05/01')
    expect(fechaCortaFeria('cualquier cosa')).toBe('cualquier cosa')
  })

  it('arma la etiqueta de la feria con nombre y fecha', () => {
    expect(etiquetaFeria({ nombre: 'Feria Plaza', fecha: '2026-10-11' })).toBe('Feria Plaza · dom 11/10')
  })

  it('hoyISO usa la fecha local', () => {
    expect(hoyISO(new Date(2026, 9, 3, 23, 59))).toBe('2026-10-03')
  })
})

describe('medios de pago', () => {
  it('reconoce los tres medios', () => {
    expect(esMedioPago('efectivo')).toBe(true)
    expect(esMedioPago('mercadopago')).toBe(true)
    expect(esMedioPago('cheque')).toBe(false)
    expect(etiquetaMedioPago('mercadopago')).toBe('Mercado Pago')
    expect(etiquetaMedioPago(null)).toBe('')
  })
})

describe('nueva feria', () => {
  it('normaliza los espacios del nombre', () => {
    expect(normalizarNombreFeria('  Feria   de  la Plaza ')).toBe('Feria de la Plaza')
  })

  it('valida nombre y fecha', () => {
    expect(validarNuevaFeria('   ', '2026-10-10')).toBe('Poné el nombre de la feria.')
    expect(validarNuevaFeria('x'.repeat(81), '2026-10-10')).toMatch(/hasta 80/)
    expect(validarNuevaFeria('Plaza', '')).toBe('Elegí la fecha de la feria.')
    expect(validarNuevaFeria('Plaza', '2026-10-10')).toBeNull()
  })

  it('ordena de la más reciente a la más vieja', () => {
    const f = (nombre: string, fecha: string) => ({ id: nombre, nombre, fecha, activa: true })
    expect(ordenarFerias([f('B', '2026-10-01'), f('C', '2026-10-10'), f('A', '2026-10-10')]).map((x) => x.id)).toEqual([
      'A',
      'C',
      'B',
    ])
  })
})

describe('preferencias de "Nuevo pedido"', () => {
  // Los tests corren en Node: localStorage en memoria.
  beforeEach(() => {
    const datos = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => datos.get(k) ?? null,
      setItem: (k: string, v: string) => void datos.set(k, v),
    })
  })

  it('sin nada guardado arranca en pedido manual y efectivo', () => {
    expect(leerPreferenciasVenta()).toEqual({ modo: 'manual', feriaId: null, medioPago: 'efectivo' })
  })

  it('recuerda modo, feria y medio de pago', () => {
    guardarPreferenciasVenta({ modo: 'feria', feriaId: 'f1', medioPago: 'transferencia' })
    expect(leerPreferenciasVenta()).toEqual({ modo: 'feria', feriaId: 'f1', medioPago: 'transferencia' })
  })

  it('ignora valores inválidos', () => {
    localStorage.setItem('pecora:nuevo-pedido', '{"modo":"otro","feriaId":3,"medioPago":"cheque"}')
    expect(leerPreferenciasVenta()).toEqual({ modo: 'manual', feriaId: null, medioPago: 'efectivo' })
    localStorage.setItem('pecora:nuevo-pedido', 'no es json')
    expect(leerPreferenciasVenta()).toEqual({ modo: 'manual', feriaId: null, medioPago: 'efectivo' })
  })
})
