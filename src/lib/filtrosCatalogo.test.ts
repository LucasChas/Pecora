import { describe, expect, it } from 'vitest'
import { enRango, esNovedad, fotosPorCategoria, leerRangoUrl, rangosDePrecio, redondearCorte, sugerencias } from './filtrosCatalogo'

describe('rangos de precio', () => {
  it('redondea los cortes', () => {
    expect(redondearCorte(4520)).toBe(5000)
    expect(redondearCorte(12500)).toBe(15000)
    expect(redondearCorte(27500)).toBe(30000)
    expect(redondearCorte(61000)).toBe(60000)
    expect(redondearCorte(300)).toBe(1000)
  })

  it('arma tres rangos por tercios', () => {
    const r = rangosDePrecio([4500, 6200, 9800, 12500, 21000, 27500, 32000, 38900])
    expect(r.map((x) => x.valor)).toEqual(['-10000', '10000-30000', '30000-'])
    expect(r[0].texto).toBe('Hasta $10.000')
    expect(r[1].texto).toBe('$10.000 a $30.000')
  })

  it('sin rangos con pocos productos o precios iguales', () => {
    expect(rangosDePrecio([1000, 2000])).toEqual([])
    expect(rangosDePrecio([5000, 5000, 5000, 5000])).toEqual([])
  })

  it('lee la URL', () => {
    expect(leerRangoUrl('-10000')).toEqual({ min: null, max: 10000 })
    expect(leerRangoUrl('10000-30000')).toEqual({ min: 10000, max: 30000 })
    expect(leerRangoUrl('30000-')).toEqual({ min: 30000, max: null })
    expect(leerRangoUrl('x')).toBeNull()
    expect(leerRangoUrl('-')).toBeNull()
    expect(leerRangoUrl('5-1')).toBeNull()
  })

  it('enRango', () => {
    expect(enRango(10000, { min: null, max: 10000 })).toBe(true)
    expect(enRango(10001, { min: null, max: 10000 })).toBe(false)
    expect(enRango(500, null)).toBe(true)
  })
})

describe('sugerencias', () => {
  const productos = [
    { nombre: 'Manta tejida', stock: 0, categoria_nombre: 'Mantas' },
    { nombre: 'Body manga larga', stock: 3, categoria_nombre: 'Bodies' },
    { nombre: 'Manta de muselina', stock: 5, categoria_nombre: 'Mantas' },
    { nombre: 'Babero impermeable', stock: 1, categoria_nombre: 'Accesorios' },
  ]

  it('prioriza los que empiezan igual y los disponibles', () => {
    expect(sugerencias(productos, 'man').map((p) => p.nombre)).toEqual([
      'Manta de muselina',
      'Manta tejida',
      'Body manga larga',
    ])
  })

  it('ignora acentos y busca por categoría', () => {
    expect(sugerencias(productos, 'MUSELÍNA').map((p) => p.nombre)).toEqual(['Manta de muselina'])
    expect(sugerencias(productos, 'accesorios').map((p) => p.nombre)).toEqual(['Babero impermeable'])
  })

  it('nada con menos de 2 letras', () => {
    expect(sugerencias(productos, 'm')).toEqual([])
  })
})

describe('fotosPorCategoria', () => {
  const p = (categoria_nombre: string | null, stock: number, imagenes: string[] = [], imagen_url: string | null = null) => ({
    categoria_nombre,
    stock,
    imagenes,
    imagen_url,
  })

  it('toma la primera foto de cada categoría, prefiriendo productos con stock', () => {
    const fotos = fotosPorCategoria([
      p('Mantas', 0, ['agotada.jpg']),
      p('Mantas', 2, ['', 'manta.jpg']),
      p('Sets', 1, [], 'set.jpg'),
      p('Sets', 3, ['otro-set.jpg']),
    ])
    expect(fotos.get('Mantas')).toBe('manta.jpg')
    expect(fotos.get('Sets')).toBe('set.jpg')
  })

  it('usa un producto agotado si es el único con foto', () => {
    expect(fotosPorCategoria([p('Toallas', 0, ['toalla.jpg']), p('Toallas', 4)]).get('Toallas')).toBe('toalla.jpg')
  })

  it('ignora productos sin categoría o sin foto', () => {
    const fotos = fotosPorCategoria([p(null, 1, ['x.jpg']), p('Baberos', 1)])
    expect(fotos.size).toBe(0)
  })
})

describe('esNovedad', () => {
  const ahora = Date.parse('2026-10-24T12:00:00Z')
  it('nuevo durante los primeros 14 días', () => {
    expect(esNovedad('2026-10-24T08:00:00Z', ahora)).toBe(true)
    expect(esNovedad('2026-10-11T12:00:01Z', ahora)).toBe(true)
  })
  it('deja de serlo a los 14 días', () => {
    expect(esNovedad('2026-10-10T12:00:00Z', ahora)).toBe(false)
  })
  it('fechas vacías, inválidas o futuras no cuentan', () => {
    expect(esNovedad(null, ahora)).toBe(false)
    expect(esNovedad('no es fecha', ahora)).toBe(false)
    expect(esNovedad('2026-11-01T00:00:00Z', ahora)).toBe(false)
  })
})
