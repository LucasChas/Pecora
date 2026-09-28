import { describe, expect, it } from 'vitest'
import {
  bearerToken,
  buildMimeMessage,
  decidirEnvios,
  encodeMimeSubject,
  esCargaManual,
  esEmailSeguro,
  formatFecha,
  formatFromHeader,
  parseItems,
  parseOwnerEmails,
  toBase64Url,
  tokensIguales,
  toNumber,
  waClienteUrl,
  wrapBase64,
} from './logica.ts'

// Decodifica base64/base64url a texto UTF-8 (para inspeccionar lo que se arma).
function desdeBase64(b64: string): string {
  return Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

function pedidoWeb(extra: Partial<Parameters<typeof decidirEnvios>[0]> = {}) {
  return {
    origen: 'checkout',
    emailEnviadoAt: null,
    avisoDuenaEnviadoAt: null,
    emailCliente: 'clienta@mail.com',
    ownerEmails: ['duena@mail.com'],
    ...extra,
  }
}

describe('decidirEnvios', () => {
  it('manda los dos mails de un pedido web nuevo', () => {
    expect(decidirEnvios(pedidoWeb())).toEqual({ tipo: 'envios', recibo: 'pending', aviso: 'pending' })
  })

  it('no manda nada para una carga manual, aunque falten las marcas', () => {
    expect(decidirEnvios(pedidoWeb({ origen: 'admin' }))).toEqual({ tipo: 'manual' })
  })

  it('no repite el recibo ya marcado, pero manda el aviso pendiente', () => {
    expect(decidirEnvios(pedidoWeb({ emailEnviadoAt: '2026-09-27T12:00:00Z' }))).toEqual({
      tipo: 'envios',
      recibo: 'already_sent',
      aviso: 'pending',
    })
  })

  it('no repite el aviso ya marcado, pero manda el recibo pendiente', () => {
    expect(decidirEnvios(pedidoWeb({ avisoDuenaEnviadoAt: '2026-09-27T12:00:00Z' }))).toEqual({
      tipo: 'envios',
      recibo: 'pending',
      aviso: 'already_sent',
    })
  })

  it('con las dos marcas no queda nada pendiente', () => {
    const d = decidirEnvios(
      pedidoWeb({ emailEnviadoAt: '2026-09-27T12:00:00Z', avisoDuenaEnviadoAt: '2026-09-27T12:00:01Z' }),
    )
    expect(d).toEqual({ tipo: 'envios', recibo: 'already_sent', aviso: 'already_sent' })
  })

  it('sin OWNER_EMAIL omite el aviso y el recibo sale igual', () => {
    expect(decidirEnvios(pedidoWeb({ ownerEmails: [] }))).toEqual({
      tipo: 'envios',
      recibo: 'pending',
      aviso: 'owner_email_unset',
    })
  })

  it('sin email de la clienta omite el recibo y el aviso sale igual', () => {
    expect(decidirEnvios(pedidoWeb({ emailCliente: '' }))).toEqual({
      tipo: 'envios',
      recibo: 'no_recipient',
      aviso: 'pending',
    })
  })

  it('un email de la clienta con salto de línea no se usa (inyección de headers)', () => {
    expect(decidirEnvios(pedidoWeb({ emailCliente: 'clienta@mail.com\r\nBcc: otro@mail.com' }))).toEqual({
      tipo: 'envios',
      recibo: 'invalid_recipient',
      aviso: 'pending',
    })
  })

  it('la marca de enviado gana sobre la falta de destinatario', () => {
    expect(
      decidirEnvios(pedidoWeb({ emailEnviadoAt: '2026-09-27T12:00:00Z', emailCliente: '' })),
    ).toMatchObject({ recibo: 'already_sent' })
  })
})

describe('esCargaManual', () => {
  it('solo el origen admin es carga manual', () => {
    expect(esCargaManual('admin')).toBe(true)
    expect(esCargaManual('checkout')).toBe(false)
    expect(esCargaManual('')).toBe(false)
  })
})

describe('bearerToken', () => {
  const req = (auth?: string) =>
    new Request('https://x.test', auth === undefined ? {} : { headers: { Authorization: auth } })

  it('extrae el token de un header Bearer', () => {
    expect(bearerToken(req('Bearer abc.def-123'))).toBe('abc.def-123')
  })

  it('no distingue mayúsculas en "Bearer" y tolera espacios', () => {
    expect(bearerToken(req('bearer   tok  '))).toBe('tok')
  })

  it('devuelve null sin header, con otro esquema o con más de un valor', () => {
    expect(bearerToken(req())).toBeNull()
    expect(bearerToken(req('Basic abc'))).toBeNull()
    expect(bearerToken(req('Bearer'))).toBeNull()
    expect(bearerToken(req('Bearer a b'))).toBeNull()
  })
})

describe('tokensIguales', () => {
  it('acepta el mismo token', async () => {
    await expect(tokensIguales('service-role-key', 'service-role-key')).resolves.toBe(true)
  })

  it('rechaza otro token, un prefijo o un token vacío', async () => {
    await expect(tokensIguales('anon-key', 'service-role-key')).resolves.toBe(false)
    await expect(tokensIguales('service-role', 'service-role-key')).resolves.toBe(false)
    await expect(tokensIguales('', 'service-role-key')).resolves.toBe(false)
  })
})

describe('esEmailSeguro', () => {
  it('acepta direcciones comunes', () => {
    expect(esEmailSeguro('ana@gmail.com')).toBe(true)
    expect(esEmailSeguro('ana.perez+pedidos@mail.com.ar')).toBe(true)
  })

  it('rechaza formatos inválidos o que podrían inyectar headers', () => {
    for (const malo of [
      '',
      'ana',
      'ana@gmail',
      'ana @gmail.com',
      'ana@gmail.com\nBcc: x@y.com',
      'ana@gmail.com\r\n',
      'a@b.com,c@d.com',
      '<ana@gmail.com>',
    ]) {
      expect(esEmailSeguro(malo), JSON.stringify(malo)).toBe(false)
    }
  })
})

describe('parseOwnerEmails', () => {
  it('sin valor no hay destinatarios', () => {
    expect(parseOwnerEmails(undefined)).toEqual({ validos: [], invalidos: 0 })
    expect(parseOwnerEmails('  ')).toEqual({ validos: [], invalidos: 0 })
  })

  it('separa por coma, recorta espacios y descarta las inválidas', () => {
    expect(parseOwnerEmails(' a@x.com, ,b@y.com , malo, c@z.com\nBcc: d@w.com')).toEqual({
      validos: ['a@x.com', 'b@y.com'],
      invalidos: 2,
    })
  })
})

describe('waClienteUrl', () => {
  it('normaliza un celular argentino con 0 y guiones', () => {
    const url = waClienteUrl('0351 15-111-1111', 12, 'Pecora')
    expect(url).toBe(
      `https://wa.me/549351151111111?text=${encodeURIComponent('Hola! Te escribo por tu pedido #12 en Pecora')}`,
    )
  })

  it('respeta un número que ya empieza con 54', () => {
    expect(waClienteUrl('+54 9 351 123 4567', 3, 'Pecora')).toMatch(/^https:\/\/wa\.me\/5493511234567\?/)
  })

  it('devuelve null si no hay dígitos', () => {
    expect(waClienteUrl('sin teléfono', 1, 'Pecora')).toBeNull()
    expect(waClienteUrl('', 1, 'Pecora')).toBeNull()
  })

  it('codifica el mensaje (la marca no puede romper la URL)', () => {
    const url = waClienteUrl('3511234567', 5, 'A&B #1')!
    expect(url).not.toContain('A&B #1')
    expect(decodeURIComponent(url.split('?text=')[1])).toBe('Hola! Te escribo por tu pedido #5 en A&B #1')
  })
})

describe('toNumber y parseItems', () => {
  it('toNumber convierte numeric de Postgres (string) y cae a 0 si no es número', () => {
    expect(toNumber('1234.50')).toBe(1234.5)
    expect(toNumber(7)).toBe(7)
    expect(toNumber('abc')).toBe(0)
    expect(toNumber(null)).toBe(0)
    expect(toNumber(Number.NaN)).toBe(0)
  })

  it('parseItems descarta ítems sin nombre o que no son objetos', () => {
    expect(
      parseItems([
        { nombre: 'Body', precio: '1000', cantidad: 2 },
        { nombre: '', precio: 1, cantidad: 1 },
        null,
        'basura',
        { precio: 1 },
        { nombre: 'Gorro', precio: 'x', cantidad: '3' },
      ]),
    ).toEqual([
      { nombre: 'Body', precio: 1000, cantidad: 2 },
      { nombre: 'Gorro', precio: 0, cantidad: 3 },
    ])
  })

  it('parseItems devuelve [] si items no es un array', () => {
    expect(parseItems({ legacy: true })).toEqual([])
    expect(parseItems(null)).toEqual([])
  })
})

describe('formatFecha', () => {
  it('usa la hora de Argentina', () => {
    // 02:30 UTC del 1/10 = 23:30 del 30/9 en Buenos Aires.
    expect(formatFecha('2026-10-01T02:30:00Z')).toBe('30/09/2026')
    // El reloj (24 h o "11:30 p. m.") depende de los datos ICU del runtime.
    expect(formatFecha('2026-10-01T02:30:00Z', true)).toMatch(/^30\/09\/2026\D+(23|11):30/)
  })
})

describe('mensaje MIME', () => {
  it('codifica el asunto y el nombre del remitente como encoded-word UTF-8', () => {
    const subject = 'Confirmación de tu pedido — Pecora'
    const enc = encodeMimeSubject(subject)
    expect(enc).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
    expect(desdeBase64(enc.slice('=?UTF-8?B?'.length, -2))).toBe(subject)
    expect(formatFromHeader('Pecora', 'tienda@gmail.com')).toBe(
      `${encodeMimeSubject('Pecora')} <tienda@gmail.com>`,
    )
  })

  it('un asunto con salto de línea no puede agregar headers', () => {
    const mime = buildMimeMessage({
      from: 'x',
      to: 'a@b.com',
      subject: 'Hola\r\nBcc: espia@mail.com',
      html: '<p>hola</p>',
    })
    const headers = mime.split('\r\n\r\n')[0].split('\r\n')
    expect(headers.map((h) => h.split(':')[0])).toEqual([
      'From',
      'To',
      'Subject',
      'MIME-Version',
      'Content-Type',
      'Content-Transfer-Encoding',
    ])
  })

  it('el cuerpo va en base64, en líneas de 76 caracteres, y se recupera igual', () => {
    const html = '<p>Ñandú</p>'.repeat(40)
    const mime = buildMimeMessage({ from: 'x', to: 'a@b.com', subject: 's', html })
    const cuerpo = mime.split('\r\n\r\n')[1]
    for (const linea of cuerpo.split('\r\n')) expect(linea.length).toBeLessThanOrEqual(76)
    expect(desdeBase64(cuerpo.replace(/\r\n/g, ''))).toBe(html)
  })

  it('wrapBase64 corta en el largo pedido', () => {
    expect(wrapBase64('abcdefgh', 3)).toBe('abc\r\ndef\r\ngh')
  })

  it('toBase64Url no deja caracteres fuera del alfabeto url-safe ni padding', () => {
    const raw = toBase64Url('?>?>?>ÿ')
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(desdeBase64(raw)).toBe('?>?>?>ÿ')
  })
})
