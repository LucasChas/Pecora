import { describe, expect, it } from 'vitest'
import { base64UrlUtf8, completarEncabezados, explicarErrorSmtp, leerConfigCorreo } from './correoConfig'

const env = (valores: Record<string, string>) => (k: string) => valores[k]

describe('leerConfigCorreo', () => {
  it('sin remitente no hay forma de mandar', () => {
    expect(leerConfigCorreo(env({ GMAIL_APP_PASSWORD: 'abcd' }))).toBeNull()
  })

  it('con contraseña de aplicación usa SMTP de Gmail en el puerto 465, sin espacios en la clave', () => {
    expect(
      leerConfigCorreo(env({ GMAIL_SENDER: ' tienda@gmail.com ', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' })),
    ).toEqual({
      via: 'smtp',
      remitente: 'tienda@gmail.com',
      host: 'smtp.gmail.com',
      port: 465,
      usuario: 'tienda@gmail.com',
      contrasena: 'abcdefghijklmnop',
    })
  })

  it('SMTP gana aunque también estén los secretos de OAuth', () => {
    const c = leerConfigCorreo(
      env({
        GMAIL_SENDER: 't@gmail.com',
        GMAIL_APP_PASSWORD: 'x',
        GMAIL_CLIENT_ID: 'id',
        GMAIL_CLIENT_SECRET: 's',
        GMAIL_REFRESH_TOKEN: 'r',
      }),
    )
    expect(c?.via).toBe('smtp')
  })

  it('sin contraseña de aplicación cae a la API de Gmail si está OAuth completo', () => {
    expect(
      leerConfigCorreo(
        env({ GMAIL_SENDER: 't@gmail.com', GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 's', GMAIL_REFRESH_TOKEN: 'r' }),
      ),
    ).toEqual({ via: 'gmail_api', remitente: 't@gmail.com', clientId: 'id', clientSecret: 's', refreshToken: 'r' })
    expect(leerConfigCorreo(env({ GMAIL_SENDER: 't@gmail.com', GMAIL_CLIENT_ID: 'id' }))).toBeNull()
  })

  it('host, puerto y usuario se pueden cambiar; un puerto inválido vuelve a 465', () => {
    const c = leerConfigCorreo(
      env({ GMAIL_SENDER: 't@x.com', GMAIL_APP_PASSWORD: 'p', SMTP_HOST: 'smtp.x.com', SMTP_PORT: '2465', SMTP_USER: 'u' }),
    )
    expect(c).toMatchObject({ host: 'smtp.x.com', port: 2465, usuario: 'u' })
    expect(leerConfigCorreo(env({ GMAIL_SENDER: 't@x.com', GMAIL_APP_PASSWORD: 'p', SMTP_PORT: 'abc' }))).toMatchObject({
      port: 465,
    })
  })
})

describe('base64UrlUtf8', () => {
  it('codifica UTF-8 en base64url sin relleno', () => {
    expect(base64UrlUtf8('¡Volvió!')).toBe(Buffer.from('¡Volvió!').toString('base64url'))
    expect(base64UrlUtf8('a'.repeat(100000))).toBe(Buffer.from('a'.repeat(100000)).toString('base64url'))
  })
})

describe('explicarErrorSmtp', () => {
  it('agrega la pista de credenciales cuando Gmail rechaza el login', () => {
    const m = explicarErrorSmtp({ code: 'EAUTH', responseCode: 535, message: 'Invalid login' })
    expect(m).toContain('EAUTH 535: Invalid login')
    expect(m).toContain('contraseña de aplicación')
  })
  it('otros errores pasan tal cual', () => {
    expect(explicarErrorSmtp({ code: 'ETIMEDOUT', message: 'timeout' })).toBe('ETIMEDOUT: timeout')
  })
})

describe('completarEncabezados', () => {
  const fecha = new Date('2026-10-01T12:00:00Z')
  it('agrega Date y Message-ID arriba si faltan', () => {
    const m = completarEncabezados('From: a@b.com\r\nSubject: x\r\n\r\ncuerpo', 'tienda@gmail.com', fecha, 'abc')
    expect(m.startsWith('Date: Thu, 01 Oct 2026 12:00:00 +0000\r\nMessage-ID: <abc@gmail.com>\r\nFrom: a@b.com')).toBe(true)
    expect(m.endsWith('\r\n\r\ncuerpo')).toBe(true)
  })
  it('no duplica los que ya están ni mira el cuerpo', () => {
    const conAmbos = 'Date: x\r\nMessage-ID: <y@z>\r\n\r\nDate: en el cuerpo'
    expect(completarEncabezados(conAmbos, 't@g.com', fecha, 'abc')).toBe(conAmbos)
    expect(completarEncabezados('Subject: s\r\n\r\nMessage-ID: no', 't@g.com', fecha, 'q')).toContain('Message-ID: <q@g.com>')
  })
})
