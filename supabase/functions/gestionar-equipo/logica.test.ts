import { describe, expect, it } from 'vitest'
import {
  armarMiembros,
  bearerToken,
  corsHeaders,
  cuerpoError,
  decidirInvitacion,
  errorConfigInvitacion,
  esEmailYaRegistrado,
  esError,
  origenPermitido,
  parseAccion,
  parseOrigenes,
  redirectInvitacion,
  validarRevocacion,
  verificarAdmin,
} from './logica.ts'

const ADMIN = '11111111-1111-4111-8111-111111111111'
const OTRA = '22222222-2222-4222-8222-222222222222'

describe('parseOrigenes / origenPermitido', () => {
  it('parses a comma-separated list, trims, drops trailing slashes and lowercases', () => {
    expect(parseOrigenes(' https://Admin.pecora.app/ , http://localhost:5173 ')).toEqual([
      'https://admin.pecora.app',
      'http://localhost:5173',
    ])
  })

  it('ignores invalid entries and an unset variable', () => {
    expect(parseOrigenes('admin.pecora.app, https://x.com/panel, ,*')).toEqual([])
    expect(parseOrigenes(undefined)).toEqual([])
  })

  it('allows only listed origins', () => {
    const lista = parseOrigenes('https://admin.pecora.app')
    expect(origenPermitido('https://admin.pecora.app', lista)).toBe(true)
    expect(origenPermitido('https://ADMIN.pecora.app/', lista)).toBe(true)
    expect(origenPermitido('https://evil.app', lista)).toBe(false)
    expect(origenPermitido('https://admin.pecora.app.evil.app', lista)).toBe(false)
    expect(origenPermitido(null, lista)).toBe(false)
  })
})

describe('corsHeaders', () => {
  const lista = ['https://admin.pecora.app']

  it('reflects an allowed origin', () => {
    const h = corsHeaders('https://admin.pecora.app', lista)
    expect(h['Access-Control-Allow-Origin']).toBe('https://admin.pecora.app')
    expect(h['Access-Control-Allow-Methods']).toBe('POST, OPTIONS')
    expect(h['Access-Control-Allow-Headers']).toContain('authorization')
    expect(h['Access-Control-Allow-Headers']).toContain('apikey')
    expect(h.Vary).toBe('Origin')
  })

  it('never uses a wildcard and omits CORS for other origins', () => {
    const h = corsHeaders('https://evil.app', lista)
    expect(h['Access-Control-Allow-Origin']).toBeUndefined()
    expect(Object.values(corsHeaders('https://admin.pecora.app', lista))).not.toContain('*')
    expect(corsHeaders(null, lista)).toEqual({ Vary: 'Origin' })
  })
})

describe('bearerToken', () => {
  it('reads the JWT from the Authorization header', () => {
    const req = new Request('https://x', { headers: { Authorization: 'Bearer abc.def.ghi' } })
    expect(bearerToken(req)).toBe('abc.def.ghi')
    expect(bearerToken(new Request('https://x'))).toBeNull()
  })
})

describe('parseAccion', () => {
  it('accepts listar', () => {
    expect(parseAccion({ accion: 'listar' })).toEqual({ accion: 'listar' })
  })

  it('normalizes the invitation', () => {
    expect(parseAccion({ accion: 'invitar', email: '  Ana@Mail.COM ', nombre: '  Ana   Pérez ' })).toEqual({
      accion: 'invitar',
      email: 'ana@mail.com',
      nombre: 'Ana Pérez',
    })
  })

  it.each([
    [{ accion: 'invitar', nombre: 'Ana' }, 'missing_email', 'Completá el email.'],
    [{ accion: 'invitar', email: 'no-es-mail', nombre: 'Ana' }, 'invalid_email', 'El email no parece válido.'],
    [{ accion: 'invitar', email: 'a@b.com\r\nBcc: x@y.com', nombre: 'Ana' }, 'invalid_email', 'El email no parece válido.'],
    [{ accion: 'invitar', email: 'a@b.com' }, 'missing_nombre', 'Completá el nombre.'],
    [{ accion: 'invitar', email: 'a@b.com', nombre: 'x'.repeat(81) }, 'invalid_nombre', 'El nombre es demasiado largo.'],
    [{ accion: 'revocar' }, 'invalid_user_id', 'Falta indicar a quién quitarle el acceso.'],
    [{ accion: 'revocar', user_id: 'abc' }, 'invalid_user_id', 'Falta indicar a quién quitarle el acceso.'],
    [{ accion: 'borrar' }, 'invalid_accion', 'Acción desconocida.'],
    [null, 'invalid_body', 'El pedido no tiene el formato esperado.'],
    [[{ accion: 'listar' }], 'invalid_body', 'El pedido no tiene el formato esperado.'],
  ])('rejects %j', (body, codigo, mensaje) => {
    const r = parseAccion(body)
    expect(esError(r)).toBe(true)
    expect(r).toMatchObject({ status: 400, codigo, mensaje })
  })

  it('accepts revocar with a uuid (lowercased)', () => {
    expect(parseAccion({ accion: 'revocar', user_id: ` ${OTRA.toUpperCase()} ` })).toEqual({
      accion: 'revocar',
      userId: OTRA,
    })
  })
})

describe('verificarAdmin', () => {
  it('only lets an admin through', () => {
    expect(verificarAdmin('admin')).toBeNull()
    for (const rol of ['empleado', 'cliente', null, undefined]) {
      expect(verificarAdmin(rol)).toMatchObject({ status: 403, codigo: 'forbidden' })
    }
  })
})

describe('decidirInvitacion', () => {
  it('invites a new email', () => {
    expect(decidirInvitacion(null)).toBe('invitar')
  })

  it('promotes an existing customer (or an account without profile)', () => {
    expect(decidirInvitacion({ id: OTRA, rol: 'cliente' })).toBe('promover')
    expect(decidirInvitacion({ id: OTRA, rol: null })).toBe('promover')
  })

  it('does nothing for an empleado', () => {
    expect(decidirInvitacion({ id: OTRA, rol: 'empleado' })).toBe('sin_cambios')
  })

  it('never downgrades an admin', () => {
    expect(decidirInvitacion({ id: OTRA, rol: 'admin' })).toMatchObject({ status: 409, codigo: 'already_admin' })
  })
})

describe('validarRevocacion', () => {
  it('revokes an empleado', () => {
    expect(validarRevocacion(ADMIN, { id: OTRA, rol: 'empleado' })).toBeNull()
  })

  it('cannot revoke yourself (any casing)', () => {
    expect(validarRevocacion(ADMIN, { id: ADMIN.toUpperCase(), rol: 'admin' })).toMatchObject({
      status: 400,
      codigo: 'self',
    })
  })

  it('cannot revoke another admin', () => {
    expect(validarRevocacion(ADMIN, { id: OTRA, rol: 'admin' })).toMatchObject({ status: 403, codigo: 'admin' })
  })

  it('rejects customers and unknown accounts', () => {
    expect(validarRevocacion(ADMIN, { id: OTRA, rol: 'cliente' })).toMatchObject({ status: 409, codigo: 'not_staff' })
    expect(validarRevocacion(ADMIN, null)).toMatchObject({ status: 404, codigo: 'not_found' })
  })
})

describe('redirectInvitacion', () => {
  const panel = parseOrigenes('https://admin.pecora.app, http://localhost:5173')

  it('accepts an https URL on the panel origin, without the trailing slash', () => {
    expect(redirectInvitacion(' https://Admin.pecora.app/ ', panel)).toEqual({
      ok: true,
      url: 'https://Admin.pecora.app',
      origen: 'https://admin.pecora.app',
    })
    expect(redirectInvitacion('https://admin.pecora.app/admin/', panel)).toEqual({
      ok: true,
      url: 'https://admin.pecora.app/admin',
      origen: 'https://admin.pecora.app',
    })
  })

  it('normalizes default ports on both sides', () => {
    expect(redirectInvitacion('https://admin.pecora.app:443', panel)).toMatchObject({ ok: true })
    expect(redirectInvitacion('https://admin.pecora.app', ['https://admin.pecora.app:443'])).toMatchObject({ ok: true })
  })

  it('allows http only for localhost / 127.0.0.1', () => {
    expect(redirectInvitacion('http://localhost:5173', panel)).toMatchObject({
      ok: true,
      origen: 'http://localhost:5173',
    })
    expect(redirectInvitacion('http://127.0.0.1:5173', ['http://127.0.0.1:5173'])).toMatchObject({ ok: true })
    expect(redirectInvitacion('http://admin.pecora.app', panel)).toMatchObject({
      ok: false,
      secreto: 'PUBLIC_ADMIN_URL',
    })
  })

  it.each([
    [undefined, /falta/],
    ['   ', /falta/],
    ['admin.pecora.app', /https/],
    ['javascript:alert(1)', /https/],
    ['ftp://admin.pecora.app', /https/],
    ['https://user:pass@admin.pecora.app', /https/],
    ['https://admin.pecora.app/a b', /https/],
  ])('rejects PUBLIC_ADMIN_URL=%j', (raw, motivo) => {
    const r = redirectInvitacion(raw, panel)
    expect(r).toMatchObject({ ok: false, secreto: 'PUBLIC_ADMIN_URL' })
    if (!r.ok) expect(r.motivo).toMatch(motivo)
  })

  it('rejects a URL whose origin is not the panel (e.g. the public storefront)', () => {
    const r = redirectInvitacion('https://pecora.app/', panel)
    expect(r).toMatchObject({ ok: false, secreto: 'PUBLIC_ADMIN_URL' })
    if (!r.ok) {
      expect(r.motivo).toContain('https://pecora.app')
      expect(r.motivo).toContain('https://admin.pecora.app')
    }
    expect(redirectInvitacion('https://admin.pecora.app.evil.app', panel)).toMatchObject({ ok: false })
  })

  it('blames ADMIN_ORIGIN when it is missing or has no usable origin', () => {
    expect(redirectInvitacion('https://admin.pecora.app', [])).toMatchObject({ ok: false, secreto: 'ADMIN_ORIGIN' })
    expect(redirectInvitacion('https://admin.pecora.app', ['http://admin.pecora.app'])).toMatchObject({
      ok: false,
      secreto: 'ADMIN_ORIGIN',
    })
  })

  it('never puts the path or query of the secret in the reason', () => {
    const r = redirectInvitacion('https://otro.app/ruta?token=secreto', panel)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).not.toMatch(/ruta|token|secreto/)
  })
})

describe('errorConfigInvitacion', () => {
  it('is a distinct 5xx code that names the secrets to check', () => {
    const e = errorConfigInvitacion()
    expect(e.status).toBeGreaterThanOrEqual(500)
    expect(e.codigo).toBe('config_invalida')
    expect(e.mensaje).toContain('PUBLIC_ADMIN_URL')
    expect(e.mensaje).toContain('ADMIN_ORIGIN')
    expect(e.mensaje).toContain('Redirect URLs')
  })
})

describe('armarMiembros', () => {
  it('maps equipo_listar rows to the panel contract and drops non-staff', () => {
    expect(
      armarMiembros([
        { id: ADMIN, email: 'a@x.com', nombre: 'Abril', rol: 'admin', ultimo_ingreso: '2026-09-01T10:00:00+00:00' },
        { id: OTRA, email: 'e@x.com', nombre: '  ', rol: 'empleado', ultimo_ingreso: null },
        { id: 'x', email: 'c@x.com', nombre: 'C', rol: 'cliente', ultimo_ingreso: null },
        null,
      ]),
    ).toEqual([
      { id: ADMIN, email: 'a@x.com', nombre: 'Abril', rol: 'admin', ultimo_ingreso: '2026-09-01T10:00:00+00:00' },
      { id: OTRA, email: 'e@x.com', nombre: null, rol: 'empleado', ultimo_ingreso: null },
    ])
    expect(armarMiembros(null)).toEqual([])
  })
})

describe('errors', () => {
  it('puts the Spanish message in `error` (shown by the panel) and the code apart', () => {
    expect(cuerpoError({ status: 403, codigo: 'forbidden', mensaje: 'Solo una admin puede gestionar el equipo.' })).toEqual({
      ok: false,
      error: 'Solo una admin puede gestionar el equipo.',
      codigo: 'forbidden',
    })
  })

  it('detects "email already registered" from inviteUserByEmail', () => {
    expect(esEmailYaRegistrado({ code: 'email_exists' })).toBe(true)
    expect(esEmailYaRegistrado({ message: 'A user with this email address has already been registered' })).toBe(true)
    expect(esEmailYaRegistrado({ message: 'rate limit exceeded' })).toBe(false)
    expect(esEmailYaRegistrado(null)).toBe(false)
  })
})
