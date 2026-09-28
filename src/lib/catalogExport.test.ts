import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Categoria, ProductoConCategoria } from '../types'
import {
  COLUMNAS,
  agruparPorCategoria,
  armarBandas,
  columnasDe,
  conTiempoMax,
  correrTareas,
  mesAnio,
  mesAnioCorto,
  paginar,
  productosDelTramo,
  type Banda,
  type Fragmento,
  type GrupoLista,
  type MedidaBanda,
  type MedidaHoja,
  type Resultado,
} from './catalogExport'

// ---- Datos de prueba ---------------------------------------------------------

function categoria(id: string, nombre: string): Categoria {
  return { id, nombre, created_at: '2026-01-01T00:00:00Z' }
}

function producto(id: string, categoria_id: string | null): ProductoConCategoria {
  return {
    id,
    nombre: `Producto ${id}`,
    categoria_id,
    descripcion: null,
    precio: 1000,
    stock: 5,
    imagen_url: null,
    slug: null,
    imagenes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    categoria_nombre: null,
  }
}

function grupo(clave: string, cantidad: number): GrupoLista {
  return {
    clave,
    titulo: clave,
    productos: Array.from({ length: cantidad }, (_, i) => producto(`${clave}-${i}`, clave)),
  }
}

const ids = (productos: ProductoConCategoria[]) => productos.map((p) => p.id)

// Generador pseudoaleatorio con semilla (mulberry32): casos variados pero reproducibles.
function aleatorio(semilla: number) {
  let s = semilla >>> 0
  const siguiente = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const entero = (min: number, max: number) => min + Math.floor(siguiente() * (max - min + 1))
  return { siguiente, entero }
}

// ---- agruparPorCategoria -----------------------------------------------------

describe('agruparPorCategoria', () => {
  const categorias = [
    categoria('a', 'Abrigos'),
    categoria('b', 'Bodys'),
    categoria('c', 'Conjuntos'),
  ]

  it('sigue el orden de las categorías, no el de los productos', () => {
    const productos = [producto('p1', 'c'), producto('p2', 'a'), producto('p3', 'b')]
    const grupos = agruparPorCategoria(productos, categorias)
    expect(grupos.map((g) => g.clave)).toEqual(['a', 'b', 'c'])
    expect(grupos.map((g) => g.titulo)).toEqual(['Abrigos', 'Bodys', 'Conjuntos'])
  })

  it('mantiene el orden de llegada de los productos dentro de cada grupo', () => {
    const productos = [
      producto('p1', 'b'),
      producto('p2', 'a'),
      producto('p3', 'b'),
      producto('p4', 'a'),
      producto('p5', 'b'),
    ]
    const grupos = agruparPorCategoria(productos, categorias)
    expect(grupos.map((g) => [g.clave, ids(g.productos)])).toEqual([
      ['a', ['p2', 'p4']],
      ['b', ['p1', 'p3', 'p5']],
    ])
  })

  it('omite las categorías sin productos', () => {
    const grupos = agruparPorCategoria([producto('p1', 'b')], categorias)
    expect(grupos.map((g) => g.clave)).toEqual(['b'])
  })

  it('junta los sin categoría y los de categorías borradas en un único "Otros" al final', () => {
    const productos = [
      producto('p1', null),
      producto('p2', 'a'),
      producto('p3', 'borrada'),
      producto('p4', 'c'),
      producto('p5', null),
      producto('p6', ''),
    ]
    const grupos = agruparPorCategoria(productos, categorias)
    expect(grupos.map((g) => g.clave)).toEqual(['a', 'c', 'otros'])
    const otros = grupos[grupos.length - 1]
    expect(otros.titulo).toBe('Otros')
    expect(ids(otros.productos)).toEqual(['p1', 'p3', 'p5', 'p6'])
  })

  it('no agrega "Otros" si todos tienen una categoría existente', () => {
    const grupos = agruparPorCategoria([producto('p1', 'a'), producto('p2', 'c')], categorias)
    expect(grupos.some((g) => g.clave === 'otros')).toBe(false)
  })

  it('sin categorías todo va a "Otros"; sin productos no hay grupos', () => {
    const grupos = agruparPorCategoria([producto('p1', 'a'), producto('p2', null)], [])
    expect(grupos).toHaveLength(1)
    expect(grupos[0].clave).toBe('otros')
    expect(ids(grupos[0].productos)).toEqual(['p1', 'p2'])
    expect(agruparPorCategoria([], categorias)).toEqual([])
  })
})

// ---- columnasDe / armarBandas -------------------------------------------------

describe('columnasDe', () => {
  it.each([
    [0, 2],
    [1, 2],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
    [6, 5],
    [23, 5],
  ])('%i productos -> %i columnas', (cantidad, columnas) => {
    expect(columnasDe(grupo('g', cantidad))).toBe(columnas)
  })
})

describe('armarBandas', () => {
  // "clave:columnas" por bloque, banda por banda.
  const forma = (bandas: Banda[]) =>
    bandas.map((banda) => banda.map((b) => `${b.grupo.clave}:${b.columnas}`))

  it('una categoría con más de 5 productos ocupa una banda sola con 5 columnas', () => {
    const bandas = armarBandas([grupo('chica', 2), grupo('grande', 12), grupo('otra', 3)])
    expect(forma(bandas)).toEqual([['chica:2'], ['grande:5'], ['otra:3']])
  })

  it('una categoría de 1 producto usa el mínimo de 2 columnas', () => {
    expect(forma(armarBandas([grupo('uno', 1)]))).toEqual([['uno:2']])
  })

  it('categorías chicas consecutivas comparten banda sin pasar de 5 columnas', () => {
    expect(forma(armarBandas([grupo('a', 3), grupo('b', 2)]))).toEqual([['a:3', 'b:2']])
    expect(forma(armarBandas([grupo('a', 1), grupo('b', 1), grupo('c', 1)]))).toEqual([
      ['a:2', 'b:2'],
      ['c:2'],
    ])
    expect(forma(armarBandas([grupo('a', 3), grupo('b', 3)]))).toEqual([['a:3'], ['b:3']])
  })

  it('respeta el orden: no reacomoda categorías para llenar huecos', () => {
    // Un armado que reordenara pondría "c" junto a "a"; acá "c" va detrás de "b".
    expect(forma(armarBandas([grupo('a', 3), grupo('b', 3), grupo('c', 2)]))).toEqual([
      ['a:3'],
      ['b:3', 'c:2'],
    ])
  })

  it('sin grupos no hay bandas', () => {
    expect(armarBandas([])).toEqual([])
  })

  it('invariantes en casos al azar: tope de 5 columnas, orden intacto, grandes solas y armado greedy', () => {
    const azar = aleatorio(7)
    for (let caso = 0; caso < 200; caso++) {
      const grupos = Array.from({ length: azar.entero(0, 12) }, (_, i) =>
        grupo(`g${i}`, azar.entero(1, 9)),
      )
      const bandas = armarBandas(grupos)
      const usadas = (banda: Banda) => banda.reduce((suma, b) => suma + b.columnas, 0)

      expect(bandas.flat().map((b) => b.grupo.clave)).toEqual(grupos.map((g) => g.clave))
      for (const banda of bandas) {
        expect(banda.length).toBeGreaterThan(0)
        expect(usadas(banda)).toBeLessThanOrEqual(COLUMNAS)
        for (const b of banda) expect(b.columnas).toBe(columnasDe(b.grupo))
        if (banda.some((b) => b.grupo.productos.length > COLUMNAS)) expect(banda).toHaveLength(1)
      }
      // Cada banda nueva arranca porque su primer bloque no entraba en la anterior.
      for (let i = 1; i < bandas.length; i++) {
        expect(usadas(bandas[i - 1]) + bandas[i][0].columnas).toBeGreaterThan(COLUMNAS)
      }
    }
  })
})

// ---- paginar -----------------------------------------------------------------

// Categoría de varias filas: cabecera fija y filas de `altoFila` separadas por `gap`.
function medidaLarga(
  filas: number,
  { cabecera = 20, altoFila = 100, gap = 10 }: { cabecera?: number; altoFila?: number; gap?: number } = {},
): MedidaBanda {
  const tramos = Array.from({ length: filas }, (_, i) => ({
    arriba: i * (altoFila + gap),
    abajo: i * (altoFila + gap) + altoFila,
  }))
  return { alto: cabecera + tramos[filas - 1].abajo, filas: { cabecera, tramos } }
}

const hoja = (capacidad: number, separacion = 10): MedidaHoja => ({ capacidad, separacion })
const entera = (banda: number): Fragmento => ({ banda, filas: null, continuacion: false })
const tramo = (banda: number, desde: number, hasta: number, continuacion: boolean): Fragmento => ({
  banda,
  filas: [desde, hasta],
  continuacion,
})

// Alto de un fragmento (banda entera o tramo de filas), como lo calcula paginar.
function altoDe(medida: MedidaBanda, filas: [number, number] | null): number {
  if (!filas) return medida.alto
  const { cabecera, tramos } = medida.filas!
  return cabecera + tramos[filas[1] - 1].abajo - tramos[filas[0]].arriba
}

// Espacio ocupado en una hoja: altos + separación entre bloques.
function ocupadoDe(fragmentos: Fragmento[], medidas: MedidaBanda[], medidaHoja: MedidaHoja) {
  return fragmentos.reduce(
    (suma, f, i) => suma + (i > 0 ? medidaHoja.separacion : 0) + altoDe(medidas[f.banda], f.filas),
    0,
  )
}

// Comprueba todas las garantías del paginado para un caso cualquiera.
function verificarPaginado(
  medidas: MedidaBanda[],
  primera: MedidaHoja,
  resto: MedidaHoja,
  hojas: Fragmento[][],
) {
  const medidaHoja = (i: number) => (i === 0 ? primera : resto)
  if (medidas.length === 0) {
    expect(hojas).toEqual([[]])
    return
  }

  // Sin hojas vacías. Con más de un bloque se respeta la capacidad; una hoja
  // pasada de capacidad solo puede tener un bloque indivisible forzado.
  hojas.forEach((fragmentos, i) => {
    expect(fragmentos.length).toBeGreaterThan(0)
    const ocupado = ocupadoDe(fragmentos, medidas, medidaHoja(i))
    if (ocupado > medidaHoja(i).capacidad) {
      expect(fragmentos).toHaveLength(1)
      const [f] = fragmentos
      const indivisible = f.filas ? f.filas[1] - f.filas[0] === 1 : !medidas[f.banda].filas
      expect(indivisible).toBe(true)
    }
  })

  // Orden de bandas y cobertura: cada banda entera una vez, o partida en tramos
  // contiguos de 0 a su última fila (solo las que traen filas).
  const planos = hojas.flat()
  for (let i = 1; i < planos.length; i++) {
    expect(planos[i].banda).toBeGreaterThanOrEqual(planos[i - 1].banda)
  }
  medidas.forEach((medida, banda) => {
    const fragmentos = planos.filter((f) => f.banda === banda)
    expect(fragmentos.length).toBeGreaterThan(0)
    if (fragmentos.length === 1 && fragmentos[0].filas === null) {
      expect(fragmentos[0].continuacion).toBe(false)
      return
    }
    expect(medida.filas).toBeDefined()
    let esperado = 0
    for (const f of fragmentos) {
      expect(f.filas).not.toBeNull()
      const [desde, hasta] = f.filas!
      expect(desde).toBe(esperado)
      expect(hasta).toBeGreaterThan(desde)
      expect(f.continuacion).toBe(desde > 0)
      esperado = hasta
    }
    expect(esperado).toBe(medida.filas!.tramos.length)
  })

  // Greedy: lo que abre cada hoja nueva no entraba (ni una fila más) en la anterior.
  for (let i = 1; i < hojas.length; i++) {
    const anterior = hojas[i - 1]
    const { capacidad, separacion } = medidaHoja(i - 1)
    const ocupado = ocupadoDe(anterior, medidas, medidaHoja(i - 1))
    const primero = hojas[i][0]
    const medida = medidas[primero.banda]
    if (primero.continuacion) {
      const ultimo = anterior[anterior.length - 1]
      expect(ultimo.banda).toBe(primero.banda)
      expect(ultimo.filas![1]).toBe(primero.filas![0])
      const sinUltimo = ocupadoDe(anterior.slice(0, -1), medidas, medidaHoja(i - 1))
      const extendido = altoDe(medida, [ultimo.filas![0], primero.filas![0] + 1])
      const costo = anterior.length > 1 ? separacion + extendido : extendido
      expect(sinUltimo + costo).toBeGreaterThan(capacidad)
    } else {
      const minimo = primero.filas ? altoDe(medida, [0, 1]) : medida.alto
      expect(ocupado + separacion + minimo).toBeGreaterThan(capacidad)
    }
  }
}

describe('paginar', () => {
  it('bandas que entran quedan en la misma hoja, sumando la separación entre ellas', () => {
    const medidas = [{ alto: 100 }, { alto: 100 }]
    // 100 + 10 + 100 = 210: justo entra.
    expect(paginar(medidas, hoja(210), hoja(210))).toEqual([[entera(0), entera(1)]])
    // Un px menos y la segunda pasa a otra hoja.
    expect(paginar(medidas, hoja(209), hoja(209))).toEqual([[entera(0)], [entera(1)]])
  })

  it('la primera hoja tiene su propia capacidad (header grande) y las demás otra', () => {
    const medidas = [{ alto: 100 }, { alto: 100 }, { alto: 100 }, { alto: 100 }]
    expect(paginar(medidas, hoja(100, 0), hoja(300, 0))).toEqual([
      [entera(0)],
      [entera(1), entera(2), entera(3)],
    ])
    expect(paginar(medidas, hoja(300, 0), hoja(100, 0))).toEqual([
      [entera(0), entera(1), entera(2)],
      [entera(3)],
    ])
  })

  it('una banda de una sola fila que no entra pasa entera a la hoja siguiente', () => {
    const medidas = [{ alto: 150 }, { alto: 100 }]
    expect(paginar(medidas, hoja(200), hoja(200))).toEqual([[entera(0)], [entera(1)]])
  })

  it('una categoría larga que entra entera no se parte', () => {
    // 3 filas: 20 + 320 = 340 <= 400.
    expect(paginar([medidaLarga(3)], hoja(400), hoja(400))).toEqual([[entera(0)]])
  })

  it('una categoría larga se parte en la fila justa y lo que sigue continúa en esa hoja', () => {
    // Filas de 100 con 10 de separación y cabecera de 20 (5 filas = 560 de alto).
    // Hoja 1: 100 ocupados + 10 + tramo [0,2) de 230 = 340; la 3.ª fila ya no entra.
    // Hoja 2: tramo [2,5) de 340 + 10 + la banda de 50 = 400, justo la capacidad.
    const medidas = [{ alto: 100 }, medidaLarga(5), { alto: 50 }]
    expect(paginar(medidas, hoja(400), hoja(400))).toEqual([
      [entera(0), tramo(1, 0, 2, false)],
      [tramo(1, 2, 5, true), entera(2)],
    ])
  })

  it('el corte de una categoría larga usa la capacidad de cada hoja', () => {
    // Primera hoja chica: 2 filas (230). La segunda es grande: entran las 4 restantes.
    expect(paginar([medidaLarga(6)], hoja(250), hoja(1000))).toEqual([
      [tramo(0, 0, 2, false)],
      [tramo(0, 2, 6, true)],
    ])
  })

  it('si no entra ni una fila en lo que queda, la categoría arranca en una hoja nueva', () => {
    // Tras la banda de 300 quedan 90 (con la separación): la 1.ª fila pide 120.
    const medidas = [{ alto: 300 }, medidaLarga(5)]
    expect(paginar(medidas, hoja(400), hoja(400))).toEqual([
      [entera(0)],
      [tramo(1, 0, 3, false)],
      [tramo(1, 3, 5, true)],
    ])
  })

  it('una banda de una fila más alta que una hoja vacía se coloca igual, sola en su hoja', () => {
    const medidas = [{ alto: 50 }, { alto: 500 }, { alto: 50 }]
    expect(paginar(medidas, hoja(200), hoja(200))).toEqual([[entera(0)], [entera(1)], [entera(2)]])
    expect(paginar([{ alto: 500 }], hoja(200), hoja(200))).toEqual([[entera(0)]])
  })

  it('si ni una fila entra en una hoja vacía, fuerza una fila por hoja sin colgarse', () => {
    // Cada fila (con su cabecera) mide 220 y la hoja tiene 100.
    const larga = medidaLarga(2, { altoFila: 200 })
    expect(paginar([larga], hoja(100), hoja(100))).toEqual([
      [tramo(0, 0, 1, false)],
      [tramo(0, 1, 2, true)],
    ])
    // Con algo antes, primero salta a una hoja nueva (no fuerza sobre una hoja ocupada).
    expect(paginar([{ alto: 50 }, larga], hoja(100), hoja(100))).toEqual([
      [entera(0)],
      [tramo(1, 0, 1, false)],
      [tramo(1, 1, 2, true)],
    ])
  })

  it('sin bandas devuelve una única hoja vacía', () => {
    expect(paginar([], hoja(400), hoja(400))).toEqual([[]])
  })

  it('invariantes en 300 casos al azar: orden, cobertura, capacidad, greedy y sin hojas vacías', () => {
    const azar = aleatorio(20260927)
    for (let caso = 0; caso < 300; caso++) {
      const medidas: MedidaBanda[] = Array.from({ length: azar.entero(0, 8) }, () =>
        azar.siguiente() < 0.4
          ? medidaLarga(azar.entero(2, 6), {
              cabecera: azar.entero(10, 40),
              altoFila: azar.entero(40, 160),
              gap: azar.entero(0, 20),
            })
          : { alto: azar.entero(30, 250) },
      )
      const primera = hoja(azar.entero(150, 500), azar.entero(0, 20))
      const resto = hoja(azar.entero(150, 600), azar.entero(0, 20))
      verificarPaginado(medidas, primera, resto, paginar(medidas, primera, resto))
    }
  })
})

// ---- productosDelTramo ---------------------------------------------------------

describe('productosDelTramo', () => {
  const g = grupo('g', 12) // 3 filas de 5: 5 + 5 + 2

  it('sin tramo devuelve todos los productos', () => {
    expect(ids(productosDelTramo(g, null))).toEqual(ids(g.productos))
  })

  it('recorta de a filas de 5 productos', () => {
    expect(ids(productosDelTramo(g, [0, 1]))).toEqual(['g-0', 'g-1', 'g-2', 'g-3', 'g-4'])
    expect(ids(productosDelTramo(g, [1, 3]))).toEqual([
      'g-5',
      'g-6',
      'g-7',
      'g-8',
      'g-9',
      'g-10',
      'g-11',
    ])
    expect(ids(productosDelTramo(g, [2, 3]))).toEqual(['g-10', 'g-11'])
  })
})

// ---- mesAnio / mesAnioCorto ----------------------------------------------------

describe('mesAnio / mesAnioCorto', () => {
  // Fecha local (no UTC) para no depender de la zona horaria de la máquina.
  const fecha = new Date(2026, 8, 27)

  it('mesAnio: mes en castellano con mayúscula inicial y año', () => {
    expect(mesAnio(fecha)).toBe('Septiembre 2026')
    expect(mesAnio(new Date(2026, 11, 31))).toBe('Diciembre 2026')
  })

  it('mesAnioCorto: tres letras y año', () => {
    expect(mesAnioCorto(fecha)).toBe('Sep 2026')
    expect(mesAnioCorto(new Date(2027, 0, 1))).toBe('Ene 2027')
  })

  it('las abreviaturas de los 12 meses son todas distintas', () => {
    const cortos = Array.from({ length: 12 }, (_, m) => mesAnioCorto(new Date(2026, m, 1)))
    expect(new Set(cortos).size).toBe(12)
  })
})

// ---- conTiempoMax --------------------------------------------------------------

describe('conTiempoMax', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('devuelve el valor si la tarea termina a tiempo y no deja el reloj pendiente', async () => {
    await expect(conTiempoMax(async () => 42, 1000)).resolves.toEqual({ ok: true, valor: 42 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('un rechazo da ok:false con el mensaje del error (nunca rechaza)', async () => {
    await expect(conTiempoMax(() => Promise.reject(new Error('404 foto')), 1000)).resolves.toEqual({
      ok: false,
      motivo: '404 foto',
    })
    await expect(conTiempoMax(() => Promise.reject('se cayó'), 1000)).resolves.toEqual({
      ok: false,
      motivo: 'se cayó',
    })
  })

  it('un error síncrono de la tarea también da ok:false', async () => {
    const tarea = (): Promise<number> => {
      throw new Error('boom')
    }
    await expect(conTiempoMax(tarea, 1000)).resolves.toEqual({ ok: false, motivo: 'boom' })
  })

  it('si la tarea nunca termina, vence el tope con el motivo documentado y aborta su señal', async () => {
    let recibida: AbortSignal | undefined
    let resultado: Resultado<number> | undefined
    const tarea = (signal: AbortSignal) => {
      recibida = signal
      return new Promise<number>(() => {})
    }
    void conTiempoMax(tarea, 1500).then((r) => {
      resultado = r
    })

    await vi.advanceTimersByTimeAsync(1499)
    expect(resultado).toBeUndefined()
    expect(recibida?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(resultado).toEqual({ ok: false, motivo: 'sin respuesta en 1.5 s' })
    expect(recibida?.aborted).toBe(true)
  })

  it('si `cancelar` ya está abortada, no corre la tarea', async () => {
    const control = new AbortController()
    control.abort()
    const tarea = vi.fn(async () => 1)
    await expect(conTiempoMax(tarea, 1000, control.signal)).resolves.toEqual({
      ok: false,
      motivo: 'cancelada',
    })
    expect(tarea).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancelar desde afuera aborta la señal de la tarea y da "cancelada"', async () => {
    const control = new AbortController()
    const tarea = (signal: AbortSignal) =>
      new Promise<number>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('AbortError')))
      })
    const promesa = conTiempoMax(tarea, 1000, control.signal)
    control.abort()
    await expect(promesa).resolves.toEqual({ ok: false, motivo: 'cancelada' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('al terminar saca su listener de `cancelar`', async () => {
    const control = new AbortController()
    const quitar = vi.spyOn(control.signal, 'removeEventListener')
    await conTiempoMax(async () => 'ok', 1000, control.signal)
    expect(quitar).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})

// ---- correrTareas --------------------------------------------------------------

describe('correrTareas', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // Tareas que tardan `demoras[e]` ms (timers falsos) y registran la concurrencia.
  function conDemoras(demoras: Record<string, number>) {
    const estado = { activas: 0, maximo: 0, terminadas: [] as string[] }
    const tarea = (e: string) => {
      estado.activas++
      estado.maximo = Math.max(estado.maximo, estado.activas)
      return new Promise<string>((resolve) =>
        setTimeout(() => {
          estado.activas--
          estado.terminadas.push(e)
          resolve(e.toUpperCase())
        }, demoras[e]),
      )
    }
    return { estado, tarea }
  }

  it('respeta el tope de concurrencia y devuelve los resultados en el orden de entrada', async () => {
    const { estado, tarea } = conDemoras({ a: 300, b: 100, c: 50, d: 10, e: 200 })
    const promesa = correrTareas(['a', 'b', 'c', 'd', 'e'], tarea, {
      concurrencia: 2,
      tiempoMax: 10_000,
    })
    await vi.runAllTimersAsync()
    const resultados = await promesa

    expect(estado.maximo).toBe(2)
    expect(estado.terminadas).not.toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(resultados).toEqual(['A', 'B', 'C', 'D', 'E'].map((valor) => ({ ok: true, valor })))
  })

  it('con concurrencia mayor que la cantidad corren todas a la vez; con 0, de a una', async () => {
    const todas = conDemoras({ a: 10, b: 10, c: 10 })
    const p1 = correrTareas(['a', 'b', 'c'], todas.tarea, { concurrencia: 10, tiempoMax: 1000 })
    await vi.runAllTimersAsync()
    expect((await p1).every((r) => r.ok)).toBe(true)
    expect(todas.estado.maximo).toBe(3)

    const deAUna = conDemoras({ a: 10, b: 10, c: 10 })
    const p2 = correrTareas(['a', 'b', 'c'], deAUna.tarea, { concurrencia: 0, tiempoMax: 1000 })
    await vi.runAllTimersAsync()
    expect((await p2).every((r) => r.ok)).toBe(true)
    expect(deAUna.estado.maximo).toBe(1)
  })

  it('un rechazo queda como {ok:false} y no frena al resto', async () => {
    const tarea = async (n: number) => {
      if (n === 2) throw new Error('falló la 2')
      return n * 10
    }
    await expect(correrTareas([1, 2, 3], tarea, { concurrencia: 1, tiempoMax: 1000 })).resolves.toEqual([
      { ok: true, valor: 10 },
      { ok: false, motivo: 'falló la 2' },
      { ok: true, valor: 30 },
    ])
  })

  it('una tarea que nunca termina vence por tiempo y el carril sigue con la próxima', async () => {
    const tarea = (n: number) => (n === 1 ? new Promise<number>(() => {}) : Promise.resolve(n))
    const promesa = correrTareas([0, 1, 2], tarea, { concurrencia: 1, tiempoMax: 2000 })
    await vi.advanceTimersByTimeAsync(2000)
    await expect(promesa).resolves.toEqual([
      { ok: true, valor: 0 },
      { ok: false, motivo: 'sin respuesta en 2 s' },
      { ok: true, valor: 2 },
    ])
  })

  it('alAvanzar informa cada tarea terminada (bien o mal) con el total', async () => {
    const alAvanzar = vi.fn()
    const tarea = async (e: string) => {
      if (e === 'b') throw new Error('x')
      return e
    }
    await correrTareas(['a', 'b', 'c'], tarea, { concurrencia: 2, tiempoMax: 1000, alAvanzar })
    expect(alAvanzar.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })

  it('cancelar desde afuera no arranca más tareas; las que no corrieron quedan "cancelada"', async () => {
    const control = new AbortController()
    const tarea = vi.fn(async (e: string) => e)
    const alAvanzar = vi.fn((hechas: number) => {
      if (hechas === 1) control.abort()
    })
    const resultados = await correrTareas(['a', 'b', 'c'], tarea, {
      concurrencia: 1,
      tiempoMax: 1000,
      cancelar: control.signal,
      alAvanzar,
    })
    expect(tarea).toHaveBeenCalledTimes(1)
    // Las que no arrancaron no cuentan como avance.
    expect(alAvanzar.mock.calls).toEqual([[1, 3]])
    expect(resultados).toEqual([
      { ok: true, valor: 'a' },
      { ok: false, motivo: 'cancelada' },
      { ok: false, motivo: 'cancelada' },
    ])
  })

  it('cancelar con tareas en curso aborta sus señales y todas quedan "cancelada"', async () => {
    const control = new AbortController()
    const tarea = vi.fn(
      (_e: number, signal: AbortSignal) =>
        new Promise<number>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('abortada')))
        }),
    )
    const promesa = correrTareas([1, 2, 3, 4], tarea, {
      concurrencia: 2,
      tiempoMax: 5000,
      cancelar: control.signal,
    })
    control.abort()
    const resultados = await promesa
    expect(tarea).toHaveBeenCalledTimes(2)
    expect(resultados).toEqual(Array.from({ length: 4 }, () => ({ ok: false, motivo: 'cancelada' })))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('si `cancelar` ya está abortada no corre ninguna tarea', async () => {
    const control = new AbortController()
    control.abort()
    const tarea = vi.fn(async (e: string) => e)
    await expect(
      correrTareas(['a', 'b'], tarea, { concurrencia: 2, tiempoMax: 1000, cancelar: control.signal }),
    ).resolves.toEqual([
      { ok: false, motivo: 'cancelada' },
      { ok: false, motivo: 'cancelada' },
    ])
    expect(tarea).not.toHaveBeenCalled()
  })

  it('lista vacía devuelve [] sin llamar a la tarea ni a alAvanzar', async () => {
    const tarea = vi.fn(async () => 1)
    const alAvanzar = vi.fn()
    await expect(
      correrTareas([], tarea, { concurrencia: 3, tiempoMax: 1000, alAvanzar }),
    ).resolves.toEqual([])
    expect(tarea).not.toHaveBeenCalled()
    expect(alAvanzar).not.toHaveBeenCalled()
  })
})
