import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn(), updateUser: vi.fn(), signOut: vi.fn() }))
const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabaseClient', () => ({ supabase: { auth, rpc } }))

import {
  cambiarEmail,
  cambiarPassword,
  eliminarMiCuenta,
  normalizarMisAvisos,
  validarCambioPassword,
  validarDatos,
  validarNuevoEmail,
} from './miCuenta'

beforeEach(() => {
  vi.clearAllMocks()
  auth.signOut.mockResolvedValue({ error: null })
})

describe('validaciones', () => {
  it('datos: nombre y teléfono con código de área', () => {
    expect(validarDatos('A', '3515551234')).toMatch(/nombre/)
    expect(validarDatos('Ana Pérez', '155551')).toMatch(/código de área/)
    expect(validarDatos('Ana Pérez', '351 555 1234')).toBeNull()
    expect(validarDatos('a'.repeat(121), '3515551234')).toMatch(/120/)
  })

  it('contraseña: actual, largo, repetida y distinta', () => {
    expect(validarCambioPassword('', 'nueva1', 'nueva1')).toMatch(/actual/)
    expect(validarCambioPassword('vieja1', 'corta', 'corta')).toMatch(/6/)
    expect(validarCambioPassword('vieja1', 'nueva12', 'nueva13')).toMatch(/no coinciden/)
    expect(validarCambioPassword('igual12', 'igual12', 'igual12')).toMatch(/distinta/)
    expect(validarCambioPassword('vieja1', 'nueva12', 'nueva12')).toBeNull()
  })

  it('email: formato y que sea otro', () => {
    expect(validarNuevoEmail('sin-arroba', 'a@b.com')).toMatch(/no es válido/)
    expect(validarNuevoEmail(' A@B.com ', 'a@b.com')).toMatch(/ya es tu email/)
    expect(validarNuevoEmail('nuevo@b.com', 'a@b.com')).toBeNull()
  })
})

describe('cambiarPassword', () => {
  it('con la contraseña actual incorrecta no cambia nada', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { code: 'invalid_credentials', message: 'Invalid login credentials' } })
    const r = await cambiarPassword('a@b.com', 'mala12', 'nueva12', 'nueva12')
    expect(r).toEqual({ ok: false, error: 'La contraseña actual no es correcta.' })
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('comprueba la actual y después cambia', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: null })
    auth.updateUser.mockResolvedValueOnce({ error: null })
    expect(await cambiarPassword('a@b.com', 'vieja1', 'nueva12', 'nueva12')).toEqual({ ok: true, valor: true })
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'nueva12' })
  })
})

describe('cambiarEmail', () => {
  it('manda el email nuevo en minúsculas y avisa si ya existe', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://tienda.test' } })
    auth.updateUser.mockResolvedValueOnce({ error: null })
    expect(await cambiarEmail(' Nueva@B.com ', 'a@b.com')).toEqual({ ok: true, valor: 'nueva@b.com' })
    expect(auth.updateUser).toHaveBeenCalledWith({ email: 'nueva@b.com' }, { emailRedirectTo: 'https://tienda.test/mi-cuenta' })
    auth.updateUser.mockResolvedValueOnce({ error: { code: 'email_exists', message: 'exists' } })
    expect(await cambiarEmail('otra@b.com', 'a@b.com')).toEqual({ ok: false, error: 'Ese email ya está usado por otra cuenta.' })
    vi.unstubAllGlobals()
  })
})

describe('normalizarMisAvisos', () => {
  it('arma la lista y descarta filas sin producto', () => {
    const r = normalizarMisAvisos([
      { producto_id: 'p1', created_at: '2026-09-01', productos: { nombre: 'Body', slug: 'body', stock: 0, imagenes: ['x.jpg'], imagen_url: null } },
      { producto_id: 'p2', created_at: '2026-09-01', productos: null },
      null,
    ])
    expect(r).toEqual([{ productoId: 'p1', nombre: 'Body', slug: 'body', imagen: 'x.jpg', stock: 0, desde: '2026-09-01' }])
    expect(normalizarMisAvisos(null)).toEqual([])
  })
})

describe('eliminarMiCuenta', () => {
  it('llama al RPC y cierra la sesión', async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null })
    expect(await eliminarMiCuenta()).toEqual({ ok: true, valor: true })
    expect(rpc).toHaveBeenCalledWith('eliminar_mi_cuenta')
    expect(auth.signOut).toHaveBeenCalled()
  })

  it('muestra el motivo si la base no lo permite (cuenta del equipo)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Las cuentas del equipo de la tienda no se pueden eliminar desde acá.' } })
    expect(await eliminarMiCuenta()).toEqual({ ok: false, error: 'Las cuentas del equipo de la tienda no se pueden eliminar desde acá.' })
    expect(auth.signOut).not.toHaveBeenCalled()
  })
})
