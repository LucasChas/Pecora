// Traducción de los errores de Supabase Auth a mensajes en castellano.
//
// Supabase devuelve mensajes en inglés ("Email not confirmed", "Password should
// be at least 6 characters"...). Se decide por `code` (estable) y, si no viene,
// por el status HTTP o el texto. Lo que no se reconoce cae en un mensaje
// genérico: nunca se le muestra inglés a la clienta.

export interface ErrorAuth {
  code?: string
  status?: number
  message?: string
}

export const MENSAJE_SIN_CONFIRMAR =
  'Todavía no confirmaste tu email. Abrí el mail que te mandamos y tocá el enlace (revisá también spam).'

const POR_CODIGO: Record<string, string> = {
  invalid_credentials: 'Email o contraseña incorrectos.',
  email_not_confirmed: MENSAJE_SIN_CONFIRMAR,
  user_already_exists: 'Ese email ya tiene una cuenta. Ingresá con tu contraseña.',
  email_exists: 'Ese email ya tiene una cuenta. Ingresá con tu contraseña.',
  weak_password: 'La contraseña es muy débil: usá al menos 6 caracteres, mezclando letras y números.',
  same_password: 'La contraseña nueva tiene que ser distinta de la anterior.',
  email_address_invalid: 'Ese email no es válido. Revisalo.',
  validation_failed: 'Revisá los datos: algún campo no es válido.',
  signup_disabled: 'Por ahora no se pueden crear cuentas nuevas.',
  over_email_send_rate_limit:
    'Mandamos demasiados mails seguidos a esa dirección. Esperá unos minutos y probá de nuevo.',
  over_request_rate_limit: 'Demasiados intentos seguidos. Esperá un minuto y probá de nuevo.',
  user_banned: 'Esta cuenta está bloqueada. Escribinos por WhatsApp.',
  session_expired: 'Tu sesión venció. Volvé a ingresar.',
  otp_expired: 'El enlace venció o ya se usó. Pedí uno nuevo.',
  reauthentication_needed: 'Por seguridad, salí, volvé a ingresar y probá de nuevo.',
  email_change_confirm_limit: 'Pediste demasiados cambios de email seguidos. Esperá un rato.',
}

export const MENSAJE_SIN_CONEXION = 'No pudimos conectarnos. Revisá tu conexión y probá de nuevo.'
export const MENSAJE_GENERICO = 'Algo salió mal. Probá de nuevo en un rato.'

export function esSinConfirmar(error: ErrorAuth | null | undefined): boolean {
  if (!error) return false
  return error.code === 'email_not_confirmed' || /email not confirmed/i.test(error.message ?? '')
}

export function traducirErrorAuth(error: ErrorAuth | null | undefined): string | null {
  if (!error) return null
  if (error.code && POR_CODIGO[error.code]) return POR_CODIGO[error.code]

  const msg = error.message ?? ''
  // Versiones viejas de supabase-js no mandan `code`: caemos al texto.
  if (/invalid login credentials/i.test(msg)) return POR_CODIGO.invalid_credentials
  if (esSinConfirmar(error)) return MENSAJE_SIN_CONFIRMAR
  if (/already (been )?registered/i.test(msg)) return POR_CODIGO.user_already_exists
  // Antes que "password should be": "New password should be different..."
  // también empieza así.
  if (/different from the old password/i.test(msg)) return POR_CODIGO.same_password
  if (/password should be|password is too weak/i.test(msg)) return POR_CODIGO.weak_password
  if (/rate limit/i.test(msg) || error.status === 429) return POR_CODIGO.over_request_rate_limit
  if (/failed to fetch|network|load failed/i.test(msg) || error.status === 0) return MENSAJE_SIN_CONEXION
  return MENSAJE_GENERICO
}
