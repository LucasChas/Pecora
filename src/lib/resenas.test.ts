import { beforeEach, describe, expect, it, vi } from 'vitest'

// Cliente simulado: solo rpc.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabaseClient', () => ({ supabase: { rpc } }))

import {
  MAX_COMENTARIO,
  MENSAJE_ERROR_GENERICO,
  MENSAJE_NO_DISPONIBLE,
  borrarResena,
  cargarEstadoPropio,
  cargarResenas,
  estrellasDePromedio,
  faltaMigracion,
  formatearPromedio,
  guardarResena,
  mensajeDeError,
  normalizarMiResena,
  normalizarModeracion,
  normalizarResenas,
  normalizarResumen,
  ocultarResena,
  textoCantidad,
  textoEstrellas,
  validarResena,
} from './resenas'

const PRODUCTO = '11111111-2222-4333-8444-555555555555'
const RESENA = '3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b'

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('validarResena', () => {
  it('acepta de 1 a 5 estrellas y recorta el comentario', () => {
    expect(validarResena(1, '  Hermoso  ')).toEqual({ ok: true, estrellas: 1, comentario: 'Hermoso' })
    expect(validarResena(5, null)).toEqual({ ok: true, estrellas: 5, comentario: null })
  })

  it('un comentario en blanco se guarda como null', () => {
    expect(validarResena(3, '   \n ')).toEqual({ ok: true, estrellas: 3, comentario: null })
  })

  it('rechaza estrellas fuera de rango, no enteras o faltantes', () => {
    for (const e of [0, 6, 2.5, Number.NaN, null, undefined]) {
      expect(validarResena(e as number | null, 'x').ok).toBe(false)
    }
  })

  it('rechaza comentarios de más de 1000 caracteres (después de recortar)', () => {
    expect(validarResena(4, 'a'.repeat(MAX_COMENTARIO)).ok).toBe(true)
    expect(validarResena(4, `  ${'a'.repeat(MAX_COMENTARIO)}  `).ok).toBe(true)
    expect(validarResena(4, 'a'.repeat(MAX_COMENTARIO + 1))).toEqual({
      ok: false,
      error: 'El comentario puede tener hasta 1000 caracteres.',
    })
  })
})

describe('normalización', () => {
  it('normalizarResenas mapea filas y descarta las inválidas', () => {
    const filas = normalizarResenas([
      {
        id: 'r1',
        estrellas: 5,
        comentario: 'Lindo',
        nombre_corto: 'Ana',
        created_at: '2026-09-01T10:00:00Z',
        updated_at: '2026-09-02T10:00:00Z',
        es_mia: true,
      },
      { id: 'r2', estrellas: '4', comentario: null, nombre_corto: '  ', created_at: '2026-09-01T10:00:00Z' },
      { id: 'r3', estrellas: 9 },
      { estrellas: 3 },
      null,
      'basura',
    ])
    expect(filas).toEqual([
      {
        id: 'r1',
        estrellas: 5,
        comentario: 'Lindo',
        nombre_corto: 'Ana',
        created_at: '2026-09-01T10:00:00Z',
        updated_at: '2026-09-02T10:00:00Z',
        es_mia: true,
      },
      {
        id: 'r2',
        estrellas: 4,
        comentario: null,
        nombre_corto: 'Cliente',
        created_at: '2026-09-01T10:00:00Z',
        updated_at: '2026-09-01T10:00:00Z',
        es_mia: false,
      },
    ])
    expect(normalizarResenas(null)).toEqual([])
  })

  it('normalizarResumen acepta objeto o arreglo y numeric como texto', () => {
    expect(normalizarResumen([{ promedio: '4.5', cantidad: 2 }])).toEqual({ promedio: 4.5, cantidad: 2 })
    expect(normalizarResumen({ promedio: 3, cantidad: '1' })).toEqual({ promedio: 3, cantidad: 1 })
    expect(normalizarResumen([{ promedio: null, cantidad: 0 }])).toEqual({ promedio: null, cantidad: 0 })
    expect(normalizarResumen(null)).toEqual({ promedio: null, cantidad: 0 })
  })

  it('normalizarMiResena devuelve null sin fila', () => {
    expect(normalizarMiResena([])).toBeNull()
    expect(
      normalizarMiResena([{ id: 'r1', estrellas: 2, comentario: null, oculta: true, created_at: 'x' }]),
    ).toEqual({ id: 'r1', estrellas: 2, comentario: null, oculta: true, created_at: 'x', updated_at: 'x' })
  })

  it('normalizarModeracion completa valores faltantes', () => {
    expect(
      normalizarModeracion([
        { id: 'r1', producto_id: 'p1', estrellas: 1, oculta: true, created_at: 'x' },
        { id: 'r2', estrellas: 1 },
      ]),
    ).toEqual([
      {
        id: 'r1',
        producto_id: 'p1',
        producto_nombre: 'Producto',
        producto_slug: null,
        estrellas: 1,
        comentario: null,
        nombre_corto: 'Cliente',
        oculta: true,
        created_at: 'x',
      },
    ])
  })
})

describe('presentación', () => {
  it('formatearPromedio usa coma y un decimal', () => {
    expect(formatearPromedio(4.25)).toBe('4,3')
    expect(formatearPromedio(5)).toBe('5,0')
    expect(formatearPromedio(null)).toBe('')
    expect(formatearPromedio(0)).toBe('')
  })

  it('textoCantidad distingue singular y plural', () => {
    expect(textoCantidad(0)).toBe('Sin reseñas')
    expect(textoCantidad(1)).toBe('1 reseña')
    expect(textoCantidad(12)).toBe('12 reseñas')
  })

  it('estrellasDePromedio redondea a la media estrella', () => {
    expect(estrellasDePromedio(4.3)).toEqual({ llenas: 4, media: true })
    expect(estrellasDePromedio(4.2)).toEqual({ llenas: 4, media: false })
    expect(estrellasDePromedio(4.8)).toEqual({ llenas: 5, media: false })
    expect(estrellasDePromedio(null)).toEqual({ llenas: 0, media: false })
  })

  it('textoEstrellas', () => {
    expect(textoEstrellas(1)).toBe('1 de 5 estrellas')
    expect(textoEstrellas(4)).toBe('4 de 5 estrellas')
  })
})

describe('errores', () => {
  it('detecta la migración sin aplicar', () => {
    expect(faltaMigracion({ code: 'PGRST202' })).toBe(true)
    expect(faltaMigracion({ code: '42883' })).toBe(true)
    expect(faltaMigracion({ code: '42501' })).toBe(false)
    expect(mensajeDeError({ code: 'PGRST202', message: 'Could not find the function' })).toBe(
      MENSAJE_NO_DISPONIBLE,
    )
  })

  it('muestra tal cual los mensajes propios de los RPCs', () => {
    const msg = 'Solo pueden opinar quienes compraron este producto.'
    expect(mensajeDeError({ code: '42501', message: msg })).toBe(msg)
    expect(mensajeDeError({ code: '22023', message: 'Elegí entre 1 y 5 estrellas.' })).toBe(
      'Elegí entre 1 y 5 estrellas.',
    )
  })

  it('un 42501 de permisos de Postgres pide iniciar sesión', () => {
    expect(mensajeDeError({ code: '42501', message: 'permission denied for function guardar_resena' })).toBe(
      'Tenés que ingresar a tu cuenta.',
    )
  })

  it('cualquier otro error da el mensaje genérico', () => {
    expect(mensajeDeError({ code: '08006', message: 'connection failure' })).toBe(MENSAJE_ERROR_GENERICO)
    expect(mensajeDeError(null)).toBe(MENSAJE_ERROR_GENERICO)
  })
})

describe('llamadas', () => {
  it('cargarResenas junta lista y resumen', async () => {
    rpc.mockImplementation((nombre: string) =>
      Promise.resolve(
        nombre === 'resenas_de_producto'
          ? { data: [{ id: 'r1', estrellas: 5, nombre_corto: 'Ana', created_at: 'x' }], error: null }
          : { data: [{ promedio: 5, cantidad: 1 }], error: null },
      ),
    )
    const r = await cargarResenas(PRODUCTO)
    expect(rpc).toHaveBeenCalledWith('resenas_de_producto', { p_producto_id: PRODUCTO })
    expect(rpc).toHaveBeenCalledWith('resumen_resenas', { p_producto_id: PRODUCTO })
    expect(r.ok && r.valor.resumen).toEqual({ promedio: 5, cantidad: 1 })
    expect(r.ok && r.valor.resenas.length).toBe(1)
  })

  it('sin la migración, cargarResenas avisa noDisponible (la sección no se muestra)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } })
    expect(await cargarResenas(PRODUCTO)).toEqual({
      ok: false,
      error: MENSAJE_NO_DISPONIBLE,
      noDisponible: true,
    })
    expect(console.error).not.toHaveBeenCalled()
  })

  it('cargarEstadoPropio', async () => {
    rpc.mockImplementation((nombre: string) =>
      Promise.resolve(
        nombre === 'puede_resenar'
          ? { data: true, error: null }
          : { data: [{ id: 'r1', estrellas: 3, comentario: 'Ok', oculta: false, created_at: 'x' }], error: null },
      ),
    )
    const r = await cargarEstadoPropio(PRODUCTO)
    expect(r.ok && r.valor.puede).toBe(true)
    expect(r.ok && r.valor.mia?.estrellas).toBe(3)
  })

  it('guardarResena valida antes de llamar a la base', async () => {
    expect(await guardarResena(PRODUCTO, 0, null)).toEqual({ ok: false, error: 'Elegí entre 1 y 5 estrellas.' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('guardarResena manda el comentario recortado', async () => {
    rpc.mockResolvedValue({ data: RESENA, error: null })
    expect(await guardarResena(PRODUCTO, 4, '  Muy lindo ')).toEqual({ ok: true, valor: RESENA })
    expect(rpc).toHaveBeenCalledWith('guardar_resena', {
      p_producto_id: PRODUCTO,
      p_estrellas: 4,
      p_comentario: 'Muy lindo',
    })
  })

  it('guardarResena devuelve el mensaje de la base', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Solo pueden opinar quienes compraron este producto.' },
    })
    expect(await guardarResena(PRODUCTO, 5, null)).toEqual({
      ok: false,
      error: 'Solo pueden opinar quienes compraron este producto.',
    })
  })

  it('borrarResena y ocultarResena devuelven el booleano del RPC', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    expect(await borrarResena(PRODUCTO)).toEqual({ ok: true, valor: true })
    expect(rpc).toHaveBeenCalledWith('borrar_resena', { p_producto_id: PRODUCTO })
    expect(await ocultarResena(RESENA, true)).toEqual({ ok: true, valor: true })
    expect(rpc).toHaveBeenCalledWith('ocultar_resena', { p_id: RESENA, p_oculta: true })
  })

  it('una excepción de red no se propaga', async () => {
    rpc.mockRejectedValue(new Error('offline'))
    expect(await borrarResena(PRODUCTO)).toEqual({ ok: false, error: MENSAJE_ERROR_GENERICO })
  })
})
