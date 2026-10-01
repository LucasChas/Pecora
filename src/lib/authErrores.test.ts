import { describe, expect, it } from 'vitest'
import {
  MENSAJE_GENERICO,
  MENSAJE_SIN_CONEXION,
  MENSAJE_SIN_CONFIRMAR,
  esSinConfirmar,
  traducirErrorAuth,
} from './authErrores'

describe('traducirErrorAuth', () => {
  it('sin error no hay mensaje', () => {
    expect(traducirErrorAuth(null)).toBeNull()
  })

  it('distingue contraseña incorrecta de email sin confirmar', () => {
    expect(traducirErrorAuth({ code: 'invalid_credentials' })).toBe('Email o contraseña incorrectos.')
    expect(traducirErrorAuth({ code: 'email_not_confirmed', message: 'Email not confirmed' })).toBe(
      MENSAJE_SIN_CONFIRMAR,
    )
  })

  it('sin code, decide por el texto en inglés', () => {
    expect(traducirErrorAuth({ message: 'Invalid login credentials' })).toBe('Email o contraseña incorrectos.')
    expect(traducirErrorAuth({ message: 'Email not confirmed' })).toBe(MENSAJE_SIN_CONFIRMAR)
    expect(traducirErrorAuth({ message: 'Password should be at least 6 characters.' })).toMatch(/débil/)
    expect(traducirErrorAuth({ message: 'New password should be different from the old password.' })).toMatch(
      /distinta/,
    )
  })

  it('límite de envíos y de intentos', () => {
    expect(traducirErrorAuth({ code: 'over_email_send_rate_limit' })).toMatch(/minutos/)
    expect(traducirErrorAuth({ status: 429, message: 'Too many requests' })).toMatch(/Esperá/)
  })

  it('sin conexión', () => {
    expect(traducirErrorAuth({ message: 'Failed to fetch' })).toBe(MENSAJE_SIN_CONEXION)
  })

  it('nunca devuelve inglés: lo desconocido es genérico', () => {
    expect(traducirErrorAuth({ code: 'algo_raro', message: 'Something weird' })).toBe(MENSAJE_GENERICO)
  })
})

describe('esSinConfirmar', () => {
  it('por code o por texto', () => {
    expect(esSinConfirmar({ code: 'email_not_confirmed' })).toBe(true)
    expect(esSinConfirmar({ message: 'Email not confirmed' })).toBe(true)
    expect(esSinConfirmar({ code: 'invalid_credentials' })).toBe(false)
    expect(esSinConfirmar(null)).toBe(false)
  })
})
