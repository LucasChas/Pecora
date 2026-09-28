import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'

const invoke = vi.hoisted(() => vi.fn())
const getSession = vi.hoisted(() => vi.fn())
vi.mock('./supabaseClient', () => ({
  supabase: { functions: { invoke }, auth: { getSession } },
}))

import {
  invitarMiembro,
  leerInvitacion,
  listarEquipo,
  MENSAJE_CONFIG_INVALIDA,
  MENSAJE_SIN_DESPLEGAR,
  mensajeDeError,
  normalizarMiembros,
  puedeRevocar,
  revocarMiembro,
  validarInvitacion,
} from './equipo'

describe('normalizarMiembros', () => {
  it('acepta array o { miembros }, descarta basura y ordena admins primero', () => {
    const datos = [
      { id: '2', email: 'zoe@x.com', nombre: 'Zoe', rol: 'empleado', ultimo_ingreso: null },
      { id: '1', email: 'ana@x.com', nombre: '', rol: 'admin', ultimo_ingreso: '2026-01-01T00:00:00Z' },
      { email: 'sin-id@x.com' },
      { id: '3', email: 'beto@x.com', nombre: 'Beto', rol: 'raro' },
    ]
    const esperado = [
      { id: '1', email: 'ana@x.com', nombre: null, rol: 'admin', ultimo_ingreso: '2026-01-01T00:00:00Z' },
      { id: '3', email: 'beto@x.com', nombre: 'Beto', rol: 'empleado', ultimo_ingreso: null },
      { id: '2', email: 'zoe@x.com', nombre: 'Zoe', rol: 'empleado', ultimo_ingreso: null },
    ]
    expect(normalizarMiembros(datos)).toEqual(esperado)
    expect(normalizarMiembros({ miembros: datos })).toEqual(esperado)
    expect(normalizarMiembros(null)).toEqual([])
  })
})

describe('puedeRevocar', () => {
  it('solo empleados y nunca a una misma', () => {
    expect(puedeRevocar({ id: 'a', rol: 'empleado' }, 'yo')).toBe(true)
    expect(puedeRevocar({ id: 'yo', rol: 'empleado' }, 'yo')).toBe(false)
    expect(puedeRevocar({ id: 'a', rol: 'admin' }, 'yo')).toBe(false)
  })
})

describe('validarInvitacion', () => {
  it('pide email válido y nombre', () => {
    expect(validarInvitacion({ email: '', nombre: 'A' })).toMatch(/email/)
    expect(validarInvitacion({ email: 'no-es-mail', nombre: 'A' })).toMatch(/no parece válido/)
    expect(validarInvitacion({ email: 'a@b.com', nombre: '  ' })).toMatch(/nombre/)
    expect(validarInvitacion({ email: ' a@b.com ', nombre: 'Ana' })).toBeNull()
  })
})

describe('mensajeDeError', () => {
  it('404 del gateway = función sin desplegar', () => {
    expect(mensajeDeError(404, { code: 'NOT_FOUND', message: 'Requested function was not found' })).toBe(
      MENSAJE_SIN_DESPLEGAR,
    )
    expect(mensajeDeError(404, null)).toBe(MENSAJE_SIN_DESPLEGAR)
  })

  it('usa el mensaje de la función si viene', () => {
    expect(mensajeDeError(400, { error: 'Ese email ya es del equipo' })).toBe('Ese email ya es del equipo')
    expect(mensajeDeError(403, {})).toMatch(/Solo una admin/)
    expect(mensajeDeError(401, {})).toMatch(/sesión venció/)
    expect(mensajeDeError(500, {})).toMatch(/\(500\)/)
  })

  it('config_invalida nombra los secretos y las Redirect URLs', () => {
    const m = mensajeDeError(500, { error: 'otra cosa', codigo: 'config_invalida' })
    expect(m).toBe(MENSAJE_CONFIG_INVALIDA)
    expect(m).toContain('PUBLIC_ADMIN_URL')
    expect(m).toContain('ADMIN_ORIGIN')
    expect(m).toContain('Redirect URLs')
  })
})

describe('leerInvitacion', () => {
  it('lee resultado y origen_link, y descarta valores raros', () => {
    expect(leerInvitacion({ resultado: 'promovida', origen_link: null })).toEqual({
      resultado: 'promovida',
      origenLink: null,
    })
    expect(leerInvitacion({ resultado: 'x', origen_link: 'javascript:alert(1)' })).toEqual({
      resultado: null,
      origenLink: null,
    })
    expect(leerInvitacion(null)).toEqual({ resultado: null, origenLink: null })
  })
})

describe('invocaciones', () => {
  beforeEach(() => {
    invoke.mockReset()
    getSession.mockReset()
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
  })

  it('listar manda el token del usuario y normaliza', async () => {
    invoke.mockResolvedValue({ data: [{ id: '1', email: 'a@x.com', rol: 'admin' }], error: null })
    const r = await listarEquipo()
    expect(invoke).toHaveBeenCalledWith('gestionar-equipo', {
      body: { accion: 'listar' },
      headers: { Authorization: 'Bearer tok' },
    })
    expect(r).toEqual({
      ok: true,
      datos: [{ id: '1', email: 'a@x.com', nombre: null, rol: 'admin', ultimo_ingreso: null }],
    })
  })

  it('invitar normaliza email y nombre', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    expect(await invitarMiembro(' Ana@X.com ', ' Ana ')).toEqual({
      ok: true,
      datos: { resultado: null, origenLink: null },
    })
    expect(invoke.mock.calls[0][1].body).toEqual({ accion: 'invitar', email: 'ana@x.com', nombre: 'Ana' })
  })

  it('invitar devuelve el resultado y el origen del link del mail', async () => {
    invoke.mockResolvedValue({
      data: { ok: true, resultado: 'invitada', miembro: null, origen_link: 'https://admin.pecora.app' },
      error: null,
    })
    expect(await invitarMiembro('ana@x.com', 'Ana')).toEqual({
      ok: true,
      datos: { resultado: 'invitada', origenLink: 'https://admin.pecora.app' },
    })
  })

  it('config_invalida → mensaje que dice qué revisar', async () => {
    const respuesta = new Response(
      JSON.stringify({ ok: false, error: 'No se mandó la invitación…', codigo: 'config_invalida' }),
      { status: 500 },
    )
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(respuesta) })
    expect(await invitarMiembro('ana@x.com', 'Ana')).toEqual({ ok: false, mensaje: MENSAJE_CONFIG_INVALIDA })
  })

  it('revocar manda user_id', async () => {
    invoke.mockResolvedValue({ data: null, error: null })
    expect(await revocarMiembro('u1')).toEqual({ ok: true, datos: null })
    expect(invoke.mock.calls[0][1].body).toEqual({ accion: 'revocar', user_id: 'u1' })
  })

  it('404 → falta desplegar', async () => {
    const respuesta = new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Requested function was not found' }), {
      status: 404,
    })
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(respuesta) })
    expect(await listarEquipo()).toEqual({ ok: false, mensaje: MENSAJE_SIN_DESPLEGAR })
  })

  it('error de red → falta desplegar o sin conexión', async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) })
    const r = await listarEquipo()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.mensaje).toMatch(/Falta desplegar la función gestionar-equipo o no hay conexión/)
  })

  it('sin sesión no invoca', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    expect(await listarEquipo()).toEqual({ ok: false, mensaje: expect.stringMatching(/sesión/) })
    expect(invoke).not.toHaveBeenCalled()
  })
})
