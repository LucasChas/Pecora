import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'

// La función se simula: el cliente real exige variables de entorno y red.
const invoke = vi.hoisted(() => vi.fn())
vi.mock('./supabaseClient', () => ({ supabase: { functions: { invoke } } }))

import {
  ErrorCotizacionVencida,
  MARGEN_VENCIMIENTO_MS,
  MENSAJE_COTIZACION_VENCIDA,
  VIGENCIA_COTIZACION_MS,
  agruparOpciones,
  armarPedidoCotizacion,
  claveCotizacion,
  clasificarErrorFuncion,
  consultarEstadoTransportistas,
  cotizarTransportistas,
  diasPlazo,
  elegirSeleccion,
  esColumnaInexistente,
  esCotizacionVencida,
  etiquetaEnvioPedido,
  etiquetaOpcion,
  etiquetaSucursal,
  formMedidasDe,
  hayMedidas,
  masEconomica,
  masRapida,
  necesitaRecotizar,
  normalizarCotizacion,
  normalizarPlazo,
  opcionEquivalente,
  parsearMedidas,
  textoPrecioOpcion,
  type OpcionEnvio,
} from './transportistas'

const plano = (s: string) => s.replace(/\s/g, ' ')

function opcion(parcial: Partial<OpcionEnvio> & { cotizacionId: string }): OpcionEnvio {
  return {
    transportista: 'andreani',
    servicio: 'domicilio',
    precio: 5000,
    plazo: null,
    sucursal: null,
    ...parcial,
  }
}

function respuestaHttp(status: number): FunctionsHttpError {
  return new FunctionsHttpError(new Response('{}', { status }))
}

describe('armarPedidoCotizacion', () => {
  const items = [
    { id: 'b', cantidad: 1 },
    { id: 'a', cantidad: 2 },
  ]

  it('hace falta provincia y un CP con 4 dígitos', () => {
    expect(armarPedidoCotizacion('5000', '', items)).toBeNull()
    expect(armarPedidoCotizacion('500', 'Córdoba', items)).toBeNull()
    expect(armarPedidoCotizacion('', 'Córdoba', items)).toBeNull()
  })

  it('normaliza el CP y ordena los ítems por id', () => {
    expect(armarPedidoCotizacion(' x5000 abc ', ' Córdoba ', items)).toEqual({
      cp: 'X5000ABC',
      provincia: 'Córdoba',
      items: [
        { producto_id: 'a', cantidad: 2 },
        { producto_id: 'b', cantidad: 1 },
      ],
    })
  })

  it('suma ítems repetidos y descarta cantidades inválidas', () => {
    const r = armarPedidoCotizacion('5000', 'Córdoba', [
      { id: 'a', cantidad: 1 },
      { id: 'a', cantidad: 2 },
      { id: 'c', cantidad: 0 },
      { id: '', cantidad: 3 },
    ])
    expect(r?.items).toEqual([{ producto_id: 'a', cantidad: 3 }])
  })

  it('sin ítems válidos no cotiza', () => {
    expect(armarPedidoCotizacion('5000', 'Córdoba', [{ id: 'a', cantidad: 0 }])).toBeNull()
  })
})

describe('claveCotizacion', () => {
  it('es la misma para el mismo carrito en otro orden y cambia con la cantidad', () => {
    const a = armarPedidoCotizacion('5000', 'Córdoba', [
      { id: 'a', cantidad: 1 },
      { id: 'b', cantidad: 1 },
    ])!
    const b = armarPedidoCotizacion('5000', 'córdoba', [
      { id: 'b', cantidad: 1 },
      { id: 'a', cantidad: 1 },
    ])!
    const c = armarPedidoCotizacion('5000', 'Córdoba', [
      { id: 'a', cantidad: 2 },
      { id: 'b', cantidad: 1 },
    ])!
    expect(claveCotizacion(a)).toBe(claveCotizacion(b))
    expect(claveCotizacion(a)).not.toBe(claveCotizacion(c))
  })
})

describe('normalizarPlazo', () => {
  it('respeta el texto y convierte números sueltos', () => {
    expect(normalizarPlazo('3 a 5 días')).toBe('3 a 5 días')
    expect(normalizarPlazo(' 4 ')).toBe('4 días')
    expect(normalizarPlazo(1)).toBe('1 día')
    expect(normalizarPlazo('')).toBeNull()
    expect(normalizarPlazo(null)).toBeNull()
    expect(normalizarPlazo(-2)).toBeNull()
  })
})

describe('normalizarCotizacion', () => {
  it('toma una respuesta válida', () => {
    const r = normalizarCotizacion({
      opciones: [
        { cotizacion_id: 'q2', transportista: 'correo_argentino', servicio: 'domicilio', precio: '6200.50', plazo: '5 a 7 días' },
        {
          cotizacion_id: 'q1',
          transportista: 'andreani',
          servicio: 'sucursal',
          precio: 4100,
          plazo: null,
          sucursal: { id: 15, nombre: 'Centro', direccion: 'Colón 123' },
        },
      ],
      zona: { precio: '2500', nombre: 'Córdoba' },
      transportistas_activos: ['correo_argentino', 'andreani', 'otro'],
    })
    expect(r.opciones.map((o) => o.cotizacionId)).toEqual(['q1', 'q2'])
    expect(r.opciones[0].sucursal).toEqual({ id: '15', nombre: 'Centro', direccion: 'Colón 123' })
    expect(r.opciones[1]).toMatchObject({ precio: 6200.5, plazo: '5 a 7 días', sucursal: null })
    expect(r.zona).toEqual({ precio: 2500, nombre: 'Córdoba' })
    expect(r.transportistasActivos).toEqual(['andreani', 'correo_argentino'])
  })

  it('descarta opciones mal formadas y repetidas', () => {
    const r = normalizarCotizacion({
      opciones: [
        null,
        'x',
        { transportista: 'andreani', servicio: 'domicilio', precio: 100 }, // sin id
        { cotizacion_id: 'a', transportista: 'oca', servicio: 'domicilio', precio: 100 },
        { cotizacion_id: 'b', transportista: 'andreani', servicio: 'express', precio: 100 },
        { cotizacion_id: 'c', transportista: 'andreani', servicio: 'domicilio', precio: -1 },
        { cotizacion_id: 'd', transportista: 'andreani', servicio: 'domicilio', precio: 'gratis' },
        { cotizacion_id: 'e', transportista: 'andreani', servicio: 'domicilio' },
        { cotizacion_id: 'f', transportista: 'andreani', servicio: 'sucursal', precio: 100 }, // sin sucursal
        { cotizacion_id: 'g', transportista: 'andreani', servicio: 'domicilio', precio: 100 },
        { cotizacion_id: 'g', transportista: 'andreani', servicio: 'domicilio', precio: 90 },
      ],
    })
    expect(r.opciones.map((o) => o.cotizacionId)).toEqual(['g'])
    expect(r.zona).toBeNull()
    expect(r.transportistasActivos).toEqual([])
  })

  it('tolera cualquier cosa sin lanzar', () => {
    for (const dato of [null, undefined, 42, 'hola', [], { opciones: 'no' }, { zona: { precio: 1 } }]) {
      expect(normalizarCotizacion(dato)).toEqual({ opciones: [], zona: null, transportistasActivos: [] })
    }
  })

  it('una opción a domicilio no arrastra sucursal', () => {
    const r = normalizarCotizacion({
      opciones: [
        {
          cotizacion_id: 'a',
          transportista: 'andreani',
          servicio: 'domicilio',
          precio: 1,
          sucursal: { id: '1', nombre: 'X', direccion: '' },
        },
      ],
    })
    expect(r.opciones[0].sucursal).toBeNull()
  })
})

describe('etiquetas', () => {
  it('arma "Transportista servicio · plazo"', () => {
    expect(etiquetaOpcion({ transportista: 'andreani', servicio: 'domicilio', plazo: '3 a 5 días' })).toBe(
      'Andreani a domicilio · 3 a 5 días',
    )
    expect(etiquetaOpcion({ transportista: 'correo_argentino', servicio: 'sucursal', plazo: null })).toBe(
      'Correo Argentino a sucursal',
    )
  })

  it('sucursal con y sin dirección', () => {
    expect(etiquetaSucursal({ id: '1', nombre: 'Centro', direccion: 'Colón 123' })).toBe('Centro — Colón 123')
    expect(etiquetaSucursal({ id: '1', nombre: 'Centro', direccion: '' })).toBe('Centro')
  })

  it('precio: gratis o en pesos', () => {
    expect(textoPrecioOpcion(0)).toBe('Gratis')
    expect(plano(textoPrecioOpcion(4500))).toBe('$ 4.500')
  })

  it('etiqueta de un pedido registrado', () => {
    const p = { transportista: 'andreani', servicio_envio: 'sucursal', sucursal_envio: ' Centro ' }
    expect(etiquetaEnvioPedido(p)).toBe('Andreani a sucursal')
    expect(etiquetaEnvioPedido(p, true)).toBe('Andreani a sucursal · Centro')
    expect(etiquetaEnvioPedido({ transportista: 'correo_argentino', servicio_envio: null })).toBe('Correo Argentino')
    expect(etiquetaEnvioPedido({ transportista: null })).toBeNull()
    expect(etiquetaEnvioPedido({})).toBeNull()
    expect(etiquetaEnvioPedido({ transportista: 'oca' })).toBeNull()
  })
})

describe('plazos y comparaciones', () => {
  it('diasPlazo lee rangos, días sueltos y horas', () => {
    expect(diasPlazo('3 a 5 días')).toEqual({ min: 3, max: 5 })
    expect(diasPlazo('2 días hábiles')).toEqual({ min: 2, max: 2 })
    expect(diasPlazo('48 hs')).toEqual({ min: 2, max: 2 })
    expect(diasPlazo('a confirmar')).toBeNull()
    expect(diasPlazo(null)).toBeNull()
  })

  const a = opcion({ cotizacionId: 'a', precio: 6000, plazo: '2 a 3 días' })
  const b = opcion({ cotizacionId: 'b', precio: 4000, plazo: '5 a 7 días', transportista: 'correo_argentino' })
  const c = opcion({ cotizacionId: 'c', precio: 4500, plazo: null, servicio: 'sucursal' })

  it('la más económica y la más rápida', () => {
    expect(masEconomica([a, b, c])?.cotizacionId).toBe('b')
    expect(masRapida([a, b, c])?.cotizacionId).toBe('a')
    expect(masEconomica([])).toBeNull()
    expect(masRapida([c])).toBeNull()
  })

  it('a igual plazo, la más rápida es la más barata', () => {
    const d = opcion({ cotizacionId: 'd', precio: 5000, plazo: '3 días' })
    const e = opcion({ cotizacionId: 'e', precio: 4000, plazo: '1 a 3 días' })
    expect(masRapida([d, e])?.cotizacionId).toBe('e')
  })
})

describe('agruparOpciones', () => {
  it('agrupa por transportista y servicio, con el precio desde', () => {
    const suc = (id: string, precio: number) =>
      opcion({ cotizacionId: id, servicio: 'sucursal', precio, sucursal: { id, nombre: id, direccion: '' } })
    const grupos = agruparOpciones([
      opcion({ cotizacionId: 'dom', precio: 7000 }),
      suc('s2', 4500),
      suc('s1', 4000),
      opcion({ cotizacionId: 'ca', transportista: 'correo_argentino', precio: 5000 }),
    ])
    expect(grupos.map((g) => g.clave)).toEqual(['andreani:sucursal', 'correo_argentino:domicilio', 'andreani:domicilio'])
    expect(grupos[0].opciones.map((o) => o.cotizacionId)).toEqual(['s1', 's2'])
    expect(grupos[0]).toMatchObject({ precioDesde: 4000, precioVariable: true })
    expect(grupos[1]).toMatchObject({ precioDesde: 5000, precioVariable: false })
  })
})

describe('opcionEquivalente y elegirSeleccion', () => {
  const vieja = opcion({
    cotizacionId: 'viejo',
    servicio: 'sucursal',
    precio: 4000,
    sucursal: { id: 's1', nombre: 'Centro', direccion: '' },
  })
  const nuevas = [
    opcion({ cotizacionId: 'n-dom', precio: 7000 }),
    opcion({ cotizacionId: 'n-s2', servicio: 'sucursal', precio: 4200, sucursal: { id: 's2', nombre: 'Norte', direccion: '' } }),
    opcion({ cotizacionId: 'n-s1', servicio: 'sucursal', precio: 4300, sucursal: { id: 's1', nombre: 'Centro', direccion: '' } }),
  ]

  it('encuentra la misma sucursal con el id nuevo', () => {
    expect(opcionEquivalente(nuevas, vieja)?.cotizacionId).toBe('n-s1')
    expect(opcionEquivalente(nuevas, { ...vieja, transportista: 'correo_argentino' })).toBeNull()
  })

  it('mantiene la opción elegida tras recotizar', () => {
    expect(
      elegirSeleccion(nuevas, 3000, { seleccion: { tipo: 'transportista', cotizacionId: 'viejo' }, opcion: vieja }),
    ).toEqual({ tipo: 'transportista', cotizacionId: 'n-s1' })
  })

  it('mantiene la zona si sigue disponible', () => {
    expect(elegirSeleccion(nuevas, 9000, { seleccion: { tipo: 'zona' }, opcion: null })).toEqual({ tipo: 'zona' })
  })

  it('sin elección previa: la más barata; a igual precio gana la zona', () => {
    expect(elegirSeleccion(nuevas, null, null)).toEqual({ tipo: 'transportista', cotizacionId: 'n-s2' })
    expect(elegirSeleccion(nuevas, 5000, null)).toEqual({ tipo: 'transportista', cotizacionId: 'n-s2' })
    expect(elegirSeleccion(nuevas, 4200, null)).toEqual({ tipo: 'zona' })
    expect(elegirSeleccion(nuevas, 0, null)).toEqual({ tipo: 'zona' })
  })

  it('sin opciones ni zona: coordinar', () => {
    expect(elegirSeleccion([], null, null)).toEqual({ tipo: 'coordinar' })
    expect(elegirSeleccion([], 2000, { seleccion: { tipo: 'coordinar' }, opcion: null })).toEqual({ tipo: 'zona' })
  })

  it('si la opción elegida desapareció, vuelve al default', () => {
    const otra = opcion({ cotizacionId: 'x', transportista: 'correo_argentino' })
    expect(
      elegirSeleccion(nuevas, null, { seleccion: { tipo: 'transportista', cotizacionId: 'x' }, opcion: otra }),
    ).toEqual({ tipo: 'transportista', cotizacionId: 'n-s2' })
  })
})

describe('necesitaRecotizar', () => {
  const t0 = 1_000_000
  it('sin clave no cotiza; sin cotización previa sí', () => {
    expect(necesitaRecotizar(null, null, t0)).toBe(false)
    expect(necesitaRecotizar(null, 'k', t0)).toBe(true)
  })

  it('cambió el carrito o el destino', () => {
    expect(necesitaRecotizar({ clave: 'k1', obtenidaEn: t0 }, 'k2', t0)).toBe(true)
    expect(necesitaRecotizar({ clave: 'k1', obtenidaEn: t0 }, 'k1', t0 + 1000)).toBe(false)
  })

  it('vence antes que en el servidor (con margen)', () => {
    const limite = t0 + VIGENCIA_COTIZACION_MS - MARGEN_VENCIMIENTO_MS
    expect(necesitaRecotizar({ clave: 'k', obtenidaEn: t0 }, 'k', limite - 1)).toBe(false)
    expect(necesitaRecotizar({ clave: 'k', obtenidaEn: t0 }, 'k', limite)).toBe(true)
    expect(necesitaRecotizar({ clave: 'k', obtenidaEn: t0 }, 'k', t0 + VIGENCIA_COTIZACION_MS - 1, 0)).toBe(false)
  })
})

describe('errores', () => {
  it('clasifica los errores de la función', () => {
    expect(clasificarErrorFuncion(respuestaHttp(404))).toBe('sin_funcion')
    expect(clasificarErrorFuncion(respuestaHttp(500))).toBe('error')
    expect(clasificarErrorFuncion(new FunctionsFetchError(new TypeError('Failed to fetch')))).toBe('red')
    expect(clasificarErrorFuncion(new FunctionsRelayError(new Response('', { status: 502 })))).toBe('red')
    expect(clasificarErrorFuncion(new TypeError('Failed to fetch'))).toBe('red')
    expect(clasificarErrorFuncion('raro')).toBe('error')
  })

  it('22023 es cotización vencida', () => {
    expect(esCotizacionVencida({ code: '22023' })).toBe(true)
    expect(esCotizacionVencida({ code: 'P0001' })).toBe(false)
    expect(esCotizacionVencida(null)).toBe(false)
    const e = new ErrorCotizacionVencida()
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toBe(MENSAJE_COTIZACION_VENCIDA)
  })

  it('columna inexistente (migración sin aplicar)', () => {
    expect(esColumnaInexistente({ code: 'PGRST204', message: '' })).toBe(true)
    expect(esColumnaInexistente({ code: '42703' })).toBe(true)
    expect(esColumnaInexistente({ message: "Could not find the 'peso_g' column of 'productos' in the schema cache" })).toBe(true)
    expect(esColumnaInexistente({ code: '23505', message: 'duplicate' })).toBe(false)
    expect(esColumnaInexistente(null)).toBe(false)
  })
})

describe('cotizarTransportistas', () => {
  const pedido = { cp: '5000', provincia: 'Córdoba', items: [{ producto_id: 'a', cantidad: 1 }] }

  beforeEach(() => {
    invoke.mockReset()
  })

  it('manda el pedido por POST y normaliza la respuesta', async () => {
    invoke.mockResolvedValueOnce({
      data: {
        opciones: [{ cotizacion_id: 'q', transportista: 'andreani', servicio: 'domicilio', precio: 5000, plazo: '3 a 5 días' }],
        zona: null,
        transportistas_activos: ['andreani'],
      },
      error: null,
    })
    const r = await cotizarTransportistas(pedido)
    expect(invoke).toHaveBeenCalledWith('cotizar-envio', expect.objectContaining({ body: pedido }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.cotizacion.opciones).toHaveLength(1)
      expect(r.cotizacion.transportistasActivos).toEqual(['andreani'])
    }
  })

  it('función sin desplegar: fallback sin lanzar', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: respuestaHttp(404) })
    expect(await cotizarTransportistas(pedido)).toEqual({ ok: false, motivo: 'sin_funcion' })
  })

  it('sin conexión: fallback', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) })
    expect(await cotizarTransportistas(pedido)).toEqual({ ok: false, motivo: 'red' })
  })

  it('respuesta que no es JSON o invoke que lanza: fallback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    invoke.mockResolvedValueOnce({ data: 'texto', error: null })
    expect(await cotizarTransportistas(pedido)).toEqual({ ok: false, motivo: 'error' })
    invoke.mockRejectedValueOnce(new Error('boom'))
    expect(await cotizarTransportistas(pedido)).toEqual({ ok: false, motivo: 'error' })
    warn.mockRestore()
  })
})

describe('consultarEstadoTransportistas', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('pide ?estado=1 por GET', async () => {
    invoke.mockResolvedValueOnce({ data: { transportistas_activos: ['correo_argentino'] }, error: null })
    expect(await consultarEstadoTransportistas()).toEqual({ ok: true, activos: ['correo_argentino'] })
    expect(invoke).toHaveBeenCalledWith('cotizar-envio?estado=1', expect.objectContaining({ method: 'GET' }))
  })

  it('sin credenciales: lista vacía', async () => {
    invoke.mockResolvedValueOnce({ data: { transportistas_activos: [] }, error: null })
    expect(await consultarEstadoTransportistas()).toEqual({ ok: true, activos: [] })
  })

  it('función sin desplegar', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: respuestaHttp(404) })
    expect(await consultarEstadoTransportistas()).toEqual({ ok: false, motivo: 'sin_funcion' })
  })
})

describe('medidas del producto', () => {
  it('vacío es null', () => {
    const r = parsearMedidas({ peso: '', alto: ' ', ancho: '', largo: '' })
    expect(r).toEqual({ ok: true, datos: { peso_g: null, alto_cm: null, ancho_cm: null, largo_cm: null } })
    if (r.ok) expect(hayMedidas(r.datos)).toBe(false)
  })

  it('acepta coma decimal y redondea', () => {
    expect(parsearMedidas({ peso: '250,6', alto: '5,25', ancho: '20', largo: '30.04' })).toEqual({
      ok: true,
      datos: { peso_g: 251, alto_cm: 5.3, ancho_cm: 20, largo_cm: 30 },
    })
  })

  it('rechaza valores fuera de rango o no numéricos', () => {
    expect(parsearMedidas({ peso: '0', alto: '', ancho: '', largo: '' }).ok).toBe(false)
    expect(parsearMedidas({ peso: 'abc', alto: '', ancho: '', largo: '' }).ok).toBe(false)
    expect(parsearMedidas({ peso: '', alto: '-1', ancho: '', largo: '' }).ok).toBe(false)
    const r = parsearMedidas({ peso: '', alto: '', ancho: '', largo: '999' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.mensaje).toMatch(/largo/)
  })

  it('formMedidasDe tolera producto sin las columnas', () => {
    expect(formMedidasDe(undefined)).toEqual({ peso: '', alto: '', ancho: '', largo: '' })
    expect(formMedidasDe({ peso_g: 300, alto_cm: null, ancho_cm: 20.5 })).toEqual({
      peso: '300',
      alto: '',
      ancho: '20.5',
      largo: '',
    })
  })
})
