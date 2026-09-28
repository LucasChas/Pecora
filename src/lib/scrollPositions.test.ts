import { describe, expect, it, vi } from 'vitest'
import {
  MAX_ENTRADAS,
  STORAGE_KEY,
  cargaInicialRestaurable,
  claveDe,
  debeRestaurar,
  escribirPosiciones,
  guardarPosicion,
  leerPosiciones,
  type Almacen,
} from './scrollPositions'

// sessionStorage falso en memoria.
function almacenFalso(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial))
  const almacen: Almacen = {
    getItem: (k) => datos.get(k) ?? null,
    setItem: (k, v) => {
      datos.set(k, v)
    },
  }
  return { almacen, datos }
}

// Almacenamiento que falla en todo (cuota llena, bloqueado).
const almacenQueFalla: Almacen = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

// Acceder a sessionStorage en sí tira error (algunos navegadores con cookies bloqueadas).
const sinAcceso = (): Almacen => {
  throw new Error('SecurityError: acceso denegado')
}

describe('claveDe', () => {
  it('combina la entrada del historial con la ruta y la query', () => {
    expect(claveDe('abc123', '/producto/body-rayado', '?talle=3')).toBe(
      'abc123|/producto/body-rayado?talle=3',
    )
  })

  it('la misma entrada con otra ruta o query da otra clave', () => {
    const base = claveDe('default', '/', '')
    expect(claveDe('default', '/cuenta', '')).not.toBe(base)
    expect(claveDe('default', '/', '?categoria=bodys')).not.toBe(base)
    expect(claveDe('otra', '/', '')).not.toBe(base)
  })
})

describe('guardarPosicion', () => {
  it('guarda la posición y mueve la clave al final (la más reciente)', () => {
    const posiciones = new Map([
      ['a', 1],
      ['b', 2],
    ])
    guardarPosicion(posiciones, 'a', 300)
    expect([...posiciones]).toEqual([
      ['b', 2],
      ['a', 300],
    ])
  })
})

describe('escribirPosiciones', () => {
  it('escribe el Map como JSON bajo su clave', () => {
    const { almacen, datos } = almacenFalso()
    escribirPosiciones(() => almacen, new Map([['k|/', 120]]))
    expect(JSON.parse(datos.get(STORAGE_KEY)!)).toEqual({ 'k|/': 120 })
  })

  it(`recorta a ${MAX_ENTRADAS} entradas descartando las más viejas`, () => {
    const { almacen, datos } = almacenFalso()
    const posiciones = new Map<string, number>()
    for (let i = 0; i < MAX_ENTRADAS + 5; i++) posiciones.set(`k${i}`, i)

    escribirPosiciones(() => almacen, posiciones)

    expect(posiciones.size).toBe(MAX_ENTRADAS)
    expect([...posiciones.keys()].slice(0, 2)).toEqual(['k5', 'k6'])
    const guardado = JSON.parse(datos.get(STORAGE_KEY)!) as Record<string, number>
    expect(Object.keys(guardado)).toHaveLength(MAX_ENTRADAS)
    expect(guardado.k0).toBeUndefined()
    expect(guardado[`k${MAX_ENTRADAS + 4}`]).toBe(MAX_ENTRADAS + 4)
  })

  it('una entrada vieja que se vuelve a usar sobrevive al recorte', () => {
    const posiciones = new Map<string, number>()
    for (let i = 0; i < MAX_ENTRADAS; i++) posiciones.set(`k${i}`, i)
    guardarPosicion(posiciones, 'k0', 999)
    guardarPosicion(posiciones, 'nueva', 1)

    escribirPosiciones(() => almacenFalso().almacen, posiciones)

    expect(posiciones.get('k0')).toBe(999)
    expect(posiciones.has('k1')).toBe(false)
    expect(posiciones.has('nueva')).toBe(true)
  })

  it('si el almacenamiento falla no rompe y el recorte en memoria igual se hace', () => {
    const posiciones = new Map<string, number>()
    for (let i = 0; i < MAX_ENTRADAS + 1; i++) posiciones.set(`k${i}`, i)
    expect(() => escribirPosiciones(() => almacenQueFalla, posiciones)).not.toThrow()
    expect(() => escribirPosiciones(sinAcceso, posiciones)).not.toThrow()
    expect(posiciones.size).toBe(MAX_ENTRADAS)
  })
})

describe('leerPosiciones', () => {
  it('carga lo guardado y descarta lo que no es un número finito', () => {
    const { almacen } = almacenFalso({
      // 1e999 se lee como Infinity.
      [STORAGE_KEY]: '{"a|/":10,"b|/":"20","c|/":null,"d|/":1e999,"e|/":0}',
    })
    const posiciones = new Map<string, number>()
    leerPosiciones(() => almacen, posiciones)
    expect([...posiciones]).toEqual([
      ['a|/', 10],
      ['e|/', 0],
    ])
  })

  it('ida y vuelta: lo escrito se lee igual y en el mismo orden', () => {
    const { almacen } = almacenFalso()
    const original = new Map([
      ['x|/', 5],
      ['y|/cuenta', 800],
    ])
    escribirPosiciones(() => almacen, original)
    const leidas = new Map<string, number>()
    leerPosiciones(() => almacen, leidas)
    expect([...leidas]).toEqual([...original])
  })

  it.each([
    ['JSON roto', '{"a|/": 1'],
    ['JSON null', 'null'],
    ['texto cualquiera', 'hola'],
  ])('ignora el contenido corrupto sin romper (%s)', (_caso, raw) => {
    const { almacen } = almacenFalso({ [STORAGE_KEY]: raw })
    const posiciones = new Map([['previa', 1]])
    expect(() => leerPosiciones(() => almacen, posiciones)).not.toThrow()
    expect([...posiciones]).toEqual([['previa', 1]])
  })

  it('sin nada guardado no hace nada', () => {
    const { almacen } = almacenFalso()
    const getItem = vi.spyOn(almacen, 'getItem')
    const posiciones = new Map<string, number>()
    leerPosiciones(() => almacen, posiciones)
    expect(getItem).toHaveBeenCalledWith(STORAGE_KEY)
    expect(posiciones.size).toBe(0)
  })

  it('si el almacenamiento falla (o ni se puede acceder) no rompe', () => {
    const posiciones = new Map<string, number>()
    expect(() => leerPosiciones(() => almacenQueFalla, posiciones)).not.toThrow()
    expect(() => leerPosiciones(sinAcceso, posiciones)).not.toThrow()
    expect(posiciones.size).toBe(0)
  })
})

describe('cargaInicialRestaurable', () => {
  it.each([
    ['reload', true],
    ['back_forward', true],
    ['navigate', false],
  ])('navegación "%s" -> %s', (type, esperado) => {
    expect(cargaInicialRestaurable(() => ({ type }))).toBe(esperado)
  })

  it('sin datos de navegación, o si consultarlos falla, no restaura', () => {
    expect(cargaInicialRestaurable(() => undefined)).toBe(false)
    expect(
      cargaInicialRestaurable(() => {
        throw new Error('performance no disponible')
      }),
    ).toBe(false)
  })
})

describe('debeRestaurar', () => {
  it('sin posición guardada nunca restaura (ni consulta la carga)', () => {
    const restaurable = vi.fn(() => true)
    expect(debeRestaurar(undefined, true, restaurable)).toBe(false)
    expect(debeRestaurar(undefined, false, restaurable)).toBe(false)
    expect(restaurable).not.toHaveBeenCalled()
  })

  it('en la carga inicial restaura solo si fue recarga o atrás/adelante', () => {
    expect(debeRestaurar(450, true, () => true)).toBe(true)
    expect(debeRestaurar(450, true, () => false)).toBe(false)
  })

  it('después de navegar dentro de la app restaura sin consultar la carga', () => {
    const restaurable = vi.fn(() => false)
    expect(debeRestaurar(450, false, restaurable)).toBe(true)
    expect(restaurable).not.toHaveBeenCalled()
  })

  it('una posición 0 guardada también cuenta', () => {
    expect(debeRestaurar(0, false, () => false)).toBe(true)
  })
})
