import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildMimeMessageConBaja,
  conTimeout,
  enmascararEmail,
  esUuid,
  FETCH_TIMEOUT_MS,
  leerProductoId,
  primeraFoto,
  RESERVA_VENCE_MINUTOS,
  resolverSitio,
  separarDestinatarios,
  SITIO_POR_DEFECTO,
  sqlReintentarAviso,
  urlBaja,
  urlProducto,
} from './logica.ts'

const TOKEN = '3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b'
const decodificar = (b64: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\r\n/g, '')), (c) => c.charCodeAt(0)))

describe('leerProductoId', () => {
  it('acepta un uuid y lo normaliza a minúsculas', () => {
    expect(leerProductoId({ producto_id: TOKEN.toUpperCase() })).toBe(TOKEN)
  })

  it('rechaza bodies sin uuid', () => {
    expect(leerProductoId(null)).toBeNull()
    expect(leerProductoId({})).toBeNull()
    expect(leerProductoId({ producto_id: 'abc' })).toBeNull()
    expect(leerProductoId({ producto_id: 42 })).toBeNull()
    expect(leerProductoId('texto')).toBeNull()
  })
})

describe('esUuid', () => {
  it('distingue uuids de otros textos', () => {
    expect(esUuid(TOKEN)).toBe(true)
    expect(esUuid(`${TOKEN}x`)).toBe(false)
    expect(esUuid(undefined)).toBe(false)
  })
})

describe('resolverSitio', () => {
  it('usa el primer candidato válido, sin barra final', () => {
    expect(resolverSitio('https://pecora.test/', 'https://otro.test')).toBe('https://pecora.test')
  })

  it('saltea vacíos, no-URLs y protocolos que no son http(s)', () => {
    expect(resolverSitio(undefined, '  ', 'no es url', 'javascript:alert(1)', 'http://b.test')).toBe(
      'http://b.test',
    )
  })

  it('sin candidatos válidos cae al muestrario', () => {
    expect(resolverSitio(undefined, null, '')).toBe(SITIO_POR_DEFECTO)
  })

  it('conserva un subpath y descarta query y hash', () => {
    expect(resolverSitio('https://a.test/tienda/?x=1#y')).toBe('https://a.test/tienda')
  })
})

describe('urlProducto / urlBaja', () => {
  it('prefiere el slug y cae al id', () => {
    expect(urlProducto('https://a.test', { id: 'id-1', slug: 'body-rosa' })).toBe(
      'https://a.test/producto/body-rosa',
    )
    expect(urlProducto('https://a.test', { id: 'id-1', slug: null })).toBe(
      'https://a.test/producto/id-1',
    )
    expect(urlProducto('https://a.test', { id: 'id-1', slug: '  ' })).toBe(
      'https://a.test/producto/id-1',
    )
  })

  it('arma el link de baja con el token', () => {
    expect(urlBaja('https://a.test', TOKEN)).toBe(`https://a.test/aviso/baja?token=${TOKEN}`)
  })
})

describe('primeraFoto', () => {
  it('toma la primera foto http(s) de la galería', () => {
    expect(
      primeraFoto({ imagenes: ['', 'data:x', 'https://cdn.test/1.jpg'], imagen_url: 'https://cdn.test/p.jpg' }),
    ).toBe('https://cdn.test/1.jpg')
  })

  it('cae a la portada y, si no hay nada, a null', () => {
    expect(primeraFoto({ imagenes: null, imagen_url: 'https://cdn.test/p.jpg' })).toBe(
      'https://cdn.test/p.jpg',
    )
    expect(primeraFoto({ imagenes: [], imagen_url: null })).toBeNull()
  })
})

describe('separarDestinatarios', () => {
  it('deja afuera emails inseguros y tokens inválidos', () => {
    const { validas, invalidas } = separarDestinatarios([
      { id: '1', email: ' ana@a.test ', token: TOKEN },
      { id: '2', email: 'mal\r\nBcc: x@y.test', token: TOKEN },
      { id: '3', email: 'bea@a.test', token: 'no-uuid' },
      { id: '4', email: '', token: TOKEN },
    ])
    expect(validas).toEqual([{ id: '1', email: 'ana@a.test', token: TOKEN }])
    expect(invalidas.map((f) => f.id)).toEqual(['2', '3', '4'])
  })
})

describe('enmascararEmail', () => {
  it('oculta la parte local', () => {
    expect(enmascararEmail('ana.perez@gmail.com')).toBe('an***@gmail.com')
    expect(enmascararEmail('sin-arroba')).toBe('***')
  })
})

describe('buildMimeMessageConBaja', () => {
  const base = {
    from: 'Pecora <p@a.test>',
    to: 'ana@a.test',
    subject: '¡Volvió Body!',
    html: '<p>Hola ñandú</p>',
  }

  it('agrega List-Unsubscribe y codifica asunto y cuerpo', () => {
    const msg = buildMimeMessageConBaja({ ...base, urlBaja: `https://a.test/aviso/baja?token=${TOKEN}` })
    const [headers, cuerpo] = msg.split('\r\n\r\n')
    expect(headers).toContain(`List-Unsubscribe: <https://a.test/aviso/baja?token=${TOKEN}>`)
    expect(headers).toContain('To: ana@a.test')
    expect(headers).toMatch(/Subject: =\?UTF-8\?B\?.+\?=/)
    expect(decodificar(cuerpo)).toBe('<p>Hola ñandú</p>')
  })

  it('omite List-Unsubscribe si la URL podría inyectar headers', () => {
    const msg = buildMimeMessageConBaja({ ...base, urlBaja: 'https://a.test/x\r\nBcc: z@z.test' })
    expect(msg).not.toContain('List-Unsubscribe')
    expect(msg).not.toContain('Bcc:')
  })
})

describe('conTimeout', () => {
  it('agrega una señal que corta a los ms indicados y conserva el resto', async () => {
    const init = conTimeout({ method: 'POST', body: 'x' }, 5)
    expect(init.method).toBe('POST')
    expect(init.body).toBe('x')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal?.aborted).toBe(false)
    await new Promise((r) => setTimeout(r, 30))
    expect(init.signal?.aborted).toBe(true)
    expect((init.signal?.reason as Error).name).toBe('TimeoutError')
  })

  it('sin init también devuelve una señal (default FETCH_TIMEOUT_MS = 15 s)', () => {
    expect(FETCH_TIMEOUT_MS).toBe(15_000)
    expect(conTimeout().signal).toBeInstanceOf(AbortSignal)
    expect(conTimeout(undefined).signal?.aborted).toBe(false)
  })

  it('respeta una señal previa: corta con la primera que se dispare', () => {
    const ctrl = new AbortController()
    const init = conTimeout({ signal: ctrl.signal }, 60_000)
    expect(init.signal).not.toBe(ctrl.signal)
    expect(init.signal?.aborted).toBe(false)
    ctrl.abort(new Error('cancelado'))
    expect(init.signal?.aborted).toBe(true)
  })
})

describe('reserva de avisos', () => {
  it('RESERVA_VENCE_MINUTOS coincide con aviso_stock_pendiente de la migración', () => {
    const dir = new URL('../../migrations/', import.meta.url)
    const archivo = readdirSync(dir).find((f) => f.endsWith('_avisos_stock.sql'))
    expect(archivo).toBeDefined()
    const sql = readFileSync(new URL(archivo!, dir), 'utf8')
    const m = sql.match(/p_reservado_at < now\(\) - interval '(\d+) minutes'/)
    expect(m?.[1]).toBe(String(RESERVA_VENCE_MINUTOS))
  })

  it('sqlReintentarAviso borra la reserva (solo si no se avisó) y vuelve a invocar', () => {
    const sql = sqlReintentarAviso(TOKEN)
    expect(sql).toContain(`set reservado_at = null where id = '${TOKEN}' and notificado_at is null;`)
    expect(sql).toContain('select public.invocar_aviso_stock(')
  })
})
