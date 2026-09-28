import { supabase } from './supabaseClient'

// "Avisame cuando vuelva" (migración *_avisos_stock.sql). Envuelve los RPCs y
// la lectura de la suscripción propia. Nunca lanza: devuelve un resultado con
// un mensaje listo para mostrar.

const PREFIJO_LOG = '[avisos]'

export const MENSAJE_NO_DISPONIBLE = 'Los avisos por mail todavía no están disponibles.'
export const MENSAJE_ERROR_GENERICO = 'No pudimos procesar el aviso. Probá de nuevo en un rato.'

interface ErrorSupabase {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** El token de baja es un uuid: se valida antes de llamar a la base. */
export function esTokenValido(token: string | null | undefined): token is string {
  return typeof token === 'string' && UUID_RE.test(token.trim())
}

/** El RPC o la tabla no existen (migración sin aplicar en este ambiente). */
function faltaMigracion(error: ErrorSupabase): boolean {
  return (
    error.code === 'PGRST202' ||
    error.code === 'PGRST205' ||
    error.code === '42883' ||
    error.code === '42P01'
  )
}

/**
 * Mensaje para la clienta. Los errores que levantan los RPCs a propósito
 * (P0001 / P0002 / 42501) ya vienen en castellano y se muestran tal cual.
 */
export function mensajeDeError(error: ErrorSupabase): string {
  if (faltaMigracion(error)) return MENSAJE_NO_DISPONIBLE
  if ((error.code === 'P0001' || error.code === 'P0002' || error.code === '42501') && error.message) {
    return error.message
  }
  return MENSAJE_ERROR_GENERICO
}

function fallo<T>(accion: string, error: unknown): Resultado<T> {
  const e = (error ?? {}) as ErrorSupabase
  console.error(`${PREFIJO_LOG} ${accion}:`, e.message ?? error)
  return { ok: false, error: mensajeDeError(e) }
}

/**
 * Email de la suscripción pendiente de la clienta logueada para el producto,
 * o null si no está anotada. (RLS: solo ve sus propias filas.)
 */
export async function consultarAviso(productoId: string): Promise<Resultado<string | null>> {
  try {
    const { data, error } = await supabase
      .from('avisos_stock')
      .select('email')
      .eq('producto_id', productoId)
      .is('notificado_at', null)
      .maybeSingle()
    if (error) return fallo('consultarAviso', error)
    const email = (data as { email?: unknown } | null)?.email
    return { ok: true, valor: typeof email === 'string' ? email : null }
  } catch (e) {
    return fallo('consultarAviso', e)
  }
}

/** Anota a la clienta logueada. Devuelve el email al que va a llegar el aviso. */
export async function suscribirAviso(productoId: string): Promise<Resultado<string>> {
  try {
    const { data, error } = await supabase.rpc('suscribir_aviso_stock', {
      p_producto_id: productoId,
    })
    if (error) return fallo('suscribirAviso', error)
    if (typeof data !== 'string' || !data) return fallo('suscribirAviso', { message: 'respuesta vacía' })
    return { ok: true, valor: data }
  } catch (e) {
    return fallo('suscribirAviso', e)
  }
}

/** Cancela el aviso pendiente. `valor` es false si no había ninguno. */
export async function cancelarAviso(productoId: string): Promise<Resultado<boolean>> {
  try {
    const { data, error } = await supabase.rpc('cancelar_aviso_stock', {
      p_producto_id: productoId,
    })
    if (error) return fallo('cancelarAviso', error)
    return { ok: true, valor: data === true }
  } catch (e) {
    return fallo('cancelarAviso', e)
  }
}

/** Baja desde el link del mail (sin login). `valor` es false si el token no existe. */
export async function darDeBajaAviso(token: string): Promise<Resultado<boolean>> {
  if (!esTokenValido(token)) return { ok: true, valor: false }
  try {
    const { data, error } = await supabase.rpc('baja_aviso_stock', { p_token: token.trim() })
    if (error) return fallo('darDeBajaAviso', error)
    return { ok: true, valor: data === true }
  } catch (e) {
    return fallo('darDeBajaAviso', e)
  }
}
