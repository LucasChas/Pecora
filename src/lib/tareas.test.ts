import { describe, expect, it } from 'vitest'
import * as catalogExport from './catalogExport'
import { conTiempoMax, correrTareas } from './tareas'

// conTiempoMax y correrTareas se prueban a fondo en catalogExport.test.ts (vía
// el re-export); acá, que el re-export es el mismo código y la opción nueva
// `detener` (dejar de arrancar tareas sin cortar las que están corriendo).

// Promesa que se resuelve a mano desde el test.
function diferida<T>() {
  let resolver!: (valor: T) => void
  const promesa = new Promise<T>((r) => {
    resolver = r
  })
  return { promesa, resolver }
}

// Deja correr las promesas pendientes (un turno del event loop).
const vaciar = () => new Promise<void>((r) => setTimeout(r, 0))

describe('re-export desde catalogExport', () => {
  it('son las mismas funciones (los imports viejos siguen andando)', () => {
    expect(catalogExport.conTiempoMax).toBe(conTiempoMax)
    expect(catalogExport.correrTareas).toBe(correrTareas)
  })
})

describe('correrTareas con detener', () => {
  it('no arranca tareas nuevas pero deja terminar las que están corriendo', async () => {
    const pendientes = new Map<string, ReturnType<typeof diferida<string>>>()
    const señales = new Map<string, AbortSignal>()
    const tarea = (e: string, signal: AbortSignal) => {
      const d = diferida<string>()
      pendientes.set(e, d)
      señales.set(e, signal)
      return d.promesa
    }
    const detener = new AbortController()
    const promesa = correrTareas(['a', 'b', 'c', 'd'], tarea, {
      concurrencia: 2,
      tiempoMax: 60_000,
      detener: detener.signal,
    })
    await vaciar()
    expect([...pendientes.keys()]).toEqual(['a', 'b'])

    detener.abort()
    pendientes.get('a')!.resolver('A')
    pendientes.get('b')!.resolver('B')

    await expect(promesa).resolves.toEqual([
      { ok: true, valor: 'A' },
      { ok: true, valor: 'B' },
      { ok: false, motivo: 'cancelada' },
      { ok: false, motivo: 'cancelada' },
    ])
    expect([...pendientes.keys()]).toEqual(['a', 'b'])
    // A diferencia de `cancelar`, no se aborta lo que ya estaba en curso.
    expect(señales.get('a')!.aborted).toBe(false)
    expect(señales.get('b')!.aborted).toBe(false)
  })

  it('ya detenida desde el principio no corre nada', async () => {
    const detener = new AbortController()
    detener.abort()
    let llamadas = 0
    const resultados = await correrTareas(
      [1, 2],
      async () => {
        llamadas++
        return 0
      },
      { concurrencia: 2, tiempoMax: 1000, detener: detener.signal },
    )
    expect(llamadas).toBe(0)
    expect(resultados).toEqual([
      { ok: false, motivo: 'cancelada' },
      { ok: false, motivo: 'cancelada' },
    ])
  })
})
