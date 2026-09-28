import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabaseClient', () => ({ supabase: { rpc } }))

import {
  aFilasDelArchivo,
  detectarSeparador,
  importarProductos,
  leerImportacion,
  MAX_FILAS,
  normalizarResultado,
  parsearCSV,
  parsearNumero,
  plantillaCSV,
  quitarBOM,
} from './importacion'

const CAB = 'sku,nombre,descripcion,precio,stock,categoria,imagen_url'

describe('parsearCSV', () => {
  it('separa por coma y por fila', () => {
    expect(parsearCSV('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('respeta comillas con separadores, saltos de línea y comillas escapadas', () => {
    const csv = 'a,b,c\r\n"hola, mundo","línea 1\nlínea 2","dice ""sí"""\r\n'
    expect(parsearCSV(csv)).toEqual([
      ['a', 'b', 'c'],
      ['hola, mundo', 'línea 1\nlínea 2', 'dice "sí"'],
    ])
  })

  it('detecta punto y coma (Excel es-AR) y quita el BOM', () => {
    const csv = '﻿sku;precio\nA1;"1.234,50"\n'
    expect(parsearCSV(csv)).toEqual([
      ['sku', 'precio'],
      ['A1', '1.234,50'],
    ])
  })

  it('acepta \\r solo y campos vacíos al final', () => {
    expect(parsearCSV('a,b,\r1,,')).toEqual([
      ['a', 'b', ''],
      ['1', '', ''],
    ])
  })

  it('mantiene las líneas vacías para no correr la numeración', () => {
    expect(parsearCSV('a\n\nb\n')).toEqual([['a'], [''], ['b']])
  })
})

describe('detectarSeparador / quitarBOM', () => {
  it('elige el que más aparece en la primera línea, fuera de comillas', () => {
    expect(detectarSeparador('a;b;c\n1,2,3,4,5')).toBe(';')
    expect(detectarSeparador('"x;y;z",b')).toBe(',')
    expect(detectarSeparador('solo')).toBe(',')
  })

  it('quita solo el BOM inicial', () => {
    expect(quitarBOM('﻿abc')).toBe('abc')
    expect(quitarBOM('abc')).toBe('abc')
  })
})

describe('parsearNumero', () => {
  it.each([
    ['1.234,50', 1234.5],
    ['1234,5', 1234.5],
    ['1,234.50', 1234.5],
    ['1.234', 1234],
    ['1.234.567', 1234567],
    ['12.5', 12.5],
    ['0.500', 0.5],
    ['$ 1.500', 1500],
    [' 10 ', 10],
    ['-3', -3],
    ['.5', 0.5],
  ])('%s → %s', (texto, esperado) => {
    expect(parsearNumero(texto)).toBe(esperado)
  })

  it.each(['', 'abc', '12a', '1,2,3,a', ',', '.'])('"%s" no es número', (texto) => {
    expect(parsearNumero(texto)).toBeNull()
  })
})

describe('leerImportacion', () => {
  it('lee filas válidas con coma decimal y columnas en otro orden', () => {
    const csv = [
      'Categoría;SKU;Nombre;Precio;Stock',
      'Bodies;B-1;Body;12.500,00;10',
      'Mantas;M-2;"Manta ""nube""";18900,5;0',
    ].join('\n')
    const r = leerImportacion(csv)
    expect(r.errores).toEqual([])
    expect(r.lineas).toEqual([2, 3])
    expect(r.filas).toEqual([
      { sku: 'B-1', nombre: 'Body', descripcion: null, precio: 12500, stock: 10, categoria: 'Bodies', imagen_url: null },
      { sku: 'M-2', nombre: 'Manta "nube"', descripcion: null, precio: 18900.5, stock: 0, categoria: 'Mantas', imagen_url: null },
    ])
  })

  it('informa columnas obligatorias faltantes en la fila 1', () => {
    const r = leerImportacion('sku,nombre\nA,B')
    expect(r.filas).toEqual([])
    expect(r.errores).toHaveLength(1)
    expect(r.errores[0].fila).toBe(1)
    expect(r.errores[0].mensaje).toMatch(/precio, stock, categoria/)
  })

  it('valida cada fila y numera como en el archivo (saltando vacías)', () => {
    const csv = [
      CAB,
      ',Sin sku,,100,1,Bodies,',
      '',
      'A,Algo,,abc,1.5,Bodies,ftp://x',
      'B,Otro,,-1,-2,,',
      'C,Bien,,10,1,Bodies,https://x.com/a.jpg',
      'c,Repetido,,10,1,Bodies,',
    ].join('\n')
    const r = leerImportacion(csv)
    expect(r.filas.map((f) => f.sku)).toEqual(['C'])
    expect(r.lineas).toEqual([6])
    const porFila = Object.fromEntries(r.errores.map((e) => [e.fila, e.mensaje]))
    expect(Object.keys(porFila).map(Number)).toEqual([2, 4, 5, 7])
    expect(porFila[2]).toMatch(/^Falta el SKU\.$/)
    expect(porFila[4]).toMatch(/precio "abc" no es un número/)
    expect(porFila[4]).toMatch(/stock "1.5" tiene que ser un número entero/)
    expect(porFila[4]).toMatch(/imagen_url/)
    expect(porFila[5]).toMatch(/^Falta la categoría/)
    expect(porFila[5]).toMatch(/precio no puede ser negativo/)
    expect(porFila[5]).toMatch(/stock no puede ser negativo/)
    expect(porFila[7]).toMatch(/SKU c ya está en la fila 6/)
  })

  it('archivo vacío o solo encabezado', () => {
    expect(leerImportacion('').errores[0].mensaje).toMatch(/vacío/)
    expect(leerImportacion(CAB + '\n').errores[0].mensaje).toMatch(/solo el encabezado/)
  })

  it(`rechaza más de ${MAX_FILAS} filas`, () => {
    const filas = Array.from({ length: MAX_FILAS + 1 }, (_, i) => `S${i},N,,1,1,C,`)
    const r = leerImportacion([CAB, ...filas].join('\n'))
    expect(r.errores[0]).toEqual({ fila: 1, mensaje: expect.stringMatching(/máximo por carga es 500/) })
  })

  it('la plantilla se lee sin errores', () => {
    const r = leerImportacion(plantillaCSV())
    expect(r.errores).toEqual([])
    expect(r.filas).toHaveLength(2)
    expect(r.filas[0].precio).toBe(12500)
    expect(r.filas[0].descripcion).toBe('Algodón peinado, talle 0 a 3 meses')
    expect(r.filas[1]).toMatchObject({ nombre: 'Manta "nube"', precio: 18900.5, imagen_url: 'https://ejemplo.com/manta.jpg' })
    expect(plantillaCSV().startsWith('﻿sku;nombre;descripcion;precio;stock;categoria;imagen_url')).toBe(true)
  })
})

describe('resultado de la RPC', () => {
  it('normaliza campos faltantes', () => {
    expect(normalizarResultado(null)).toEqual({ nuevos: 0, actualizados: 0, errores: [] })
    expect(normalizarResultado({ nuevos: 2, actualizados: '1', errores: [{ fila: 1 }] })).toEqual({
      nuevos: 2,
      actualizados: 1,
      errores: [{ fila: 1, mensaje: 'Error sin detalle' }],
    })
  })

  it('pasa la posición en p_filas a la fila del archivo', () => {
    const r = aFilasDelArchivo(
      { nuevos: 0, actualizados: 0, errores: [{ fila: 2, mensaje: 'x' }, { fila: 9, mensaje: 'y' }] },
      [2, 5],
    )
    expect(r.errores).toEqual([
      { fila: 5, mensaje: 'x' },
      { fila: 9, mensaje: 'y' },
    ])
  })
})

describe('importarProductos', () => {
  beforeEach(() => rpc.mockReset())

  const fila = { sku: 'A', nombre: 'N', precio: 1, stock: 1, categoria: 'C' }

  it('llama a la RPC con p_simular', async () => {
    rpc.mockResolvedValue({ data: { nuevos: 1, actualizados: 0, errores: [] }, error: null })
    const r = await importarProductos([fila], true)
    expect(rpc).toHaveBeenCalledWith('importar_productos', { p_filas: [fila], p_simular: true })
    expect(r).toEqual({ ok: true, resultado: { nuevos: 1, actualizados: 0, errores: [] } })
  })

  it('avisa si falta la migración', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find' } })
    const r = await importarProductos([fila], false)
    expect(r).toEqual({ ok: false, mensaje: expect.stringMatching(/Falta aplicar la migración importar_productos/) })
  })

  it('devuelve el mensaje de la base en otros errores', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permiso denegado' } })
    expect(await importarProductos([fila], false)).toEqual({ ok: false, mensaje: 'permiso denegado' })
  })
})
