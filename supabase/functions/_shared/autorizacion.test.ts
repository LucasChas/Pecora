import { beforeEach, describe, expect, it, vi } from 'vitest'
import { esLlamadaInterna, olvidarVerificacion, rolDelJwt } from './autorizacion'

const jwt = (payload: object) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.firma`
const SERVICE = jwt({ role: 'service_role', ref: 'abc' })
const ANON = jwt({ role: 'anon' })
const env = (v: Record<string, string>) => (k: string) => v[k]
const ENV = env({ SUPABASE_URL: 'https://abc.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'otra-version' })

beforeEach(() => olvidarVerificacion())

describe('rolDelJwt', () => {
  it('lee el role del payload', () => {
    expect(rolDelJwt(SERVICE)).toBe('service_role')
    expect(rolDelJwt(ANON)).toBe('anon')
    expect(rolDelJwt('sb_secret_xxx')).toBeNull()
    expect(rolDelJwt('a.%%%.c')).toBeNull()
  })
})

describe('esLlamadaInterna', () => {
  it('acepta sin consultar nada si es igual a SUPABASE_SERVICE_ROLE_KEY', async () => {
    const f = vi.fn()
    expect(await esLlamadaInterna('otra-version', ENV, f)).toEqual({ ok: true, via: 'clave_igual' })
    expect(f).not.toHaveBeenCalled()
  })

  it('rechaza la anon key sin consultar a Supabase', async () => {
    const f = vi.fn()
    const r = await esLlamadaInterna(ANON, ENV, f)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.motivo).toContain('role: anon')
    expect(f).not.toHaveBeenCalled()
  })

  it('una service_role distinta de la variable se acepta si Auth la confirma', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    expect(await esLlamadaInterna(SERVICE, ENV, f as unknown as typeof fetch)).toEqual({ ok: true, via: 'verificada' })
    expect(f).toHaveBeenCalledWith(
      'https://abc.supabase.co/auth/v1/admin/users?page=1&per_page=1',
      expect.objectContaining({ headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }),
    )
  })

  it('un token fabricado con role service_role se rechaza si Auth no lo acepta', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 401 }))
    const r = await esLlamadaInterna(SERVICE, ENV, f as unknown as typeof fetch)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.motivo).toContain('(401)')
  })

  it('recuerda la verificación unos minutos y después vuelve a consultar', async () => {
    let t = 1_000
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    const ff = f as unknown as typeof fetch
    await esLlamadaInterna(SERVICE, ENV, ff, () => t)
    t += 60_000
    await esLlamadaInterna(SERVICE, ENV, ff, () => t)
    expect(f).toHaveBeenCalledTimes(1)
    t += 11 * 60_000
    await esLlamadaInterna(SERVICE, ENV, ff, () => t)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('si Supabase no responde, rechaza con el motivo', async () => {
    const f = vi.fn(async () => {
      throw new Error('red caída')
    })
    const r = await esLlamadaInterna(SERVICE, ENV, f as unknown as typeof fetch)
    expect(!r.ok && r.motivo).toContain('red caída')
  })
})
