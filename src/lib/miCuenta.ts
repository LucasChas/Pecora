import { supabase } from './supabaseClient'
import { traducirErrorAuth } from './authErrores'
import { errorTelefono } from './borradorCheckout'
import { portadaDe } from './images'

// ============================================================================
// "Mi cuenta" de la clienta: datos, preferencias, contraseña, email, avisos de
// stock y baja de la cuenta. Las funciones no lanzan: devuelven un resultado
// con un mensaje listo para mostrar.
// ============================================================================

export type Resultado<T = true> = { ok: true; valor: T } | { ok: false; error: string }

const ERROR_GENERICO = 'No pudimos guardar los cambios. Probá de nuevo en un rato.'
const MAX_NOMBRE = 120
const MAX_TELEFONO = 40
export const MIN_PASSWORD = 6

// ---- Validaciones (las mismas reglas que la base y Supabase Auth) ----------

export function validarDatos(nombre: string, telefono: string): string | null {
  const n = nombre.trim()
  if (n.length < 2) return 'Escribí tu nombre y apellido.'
  if (n.length > MAX_NOMBRE) return `El nombre puede tener hasta ${MAX_NOMBRE} letras.`
  if (telefono.trim().length > MAX_TELEFONO) return 'El teléfono es demasiado largo.'
  return errorTelefono(telefono)
}

export function validarCambioPassword(actual: string, nueva: string, repetida: string): string | null {
  if (!actual) return 'Escribí tu contraseña actual.'
  if (nueva.length < MIN_PASSWORD) return `La contraseña nueva tiene que tener al menos ${MIN_PASSWORD} caracteres.`
  if (nueva !== repetida) return 'Las contraseñas nuevas no coinciden.'
  if (nueva === actual) return 'La contraseña nueva tiene que ser distinta de la actual.'
  return null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function validarNuevoEmail(nuevo: string, actual: string | null | undefined): string | null {
  const e = nuevo.trim().toLowerCase()
  if (!EMAIL_RE.test(e)) return 'Ese email no es válido. Revisalo.'
  if (actual && e === actual.trim().toLowerCase()) return 'Ese ya es tu email.'
  return null
}

// ---- Datos y preferencias ----------------------------------------------------

export async function guardarMisDatos(userId: string, nombre: string, telefono: string): Promise<Resultado> {
  const v = validarDatos(nombre, telefono)
  if (v) return { ok: false, error: v }
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ nombre: nombre.trim(), telefono: telefono.trim() })
      .eq('id', userId)
    if (error) return { ok: false, error: ERROR_GENERICO }
    return { ok: true, valor: true }
  } catch {
    return { ok: false, error: ERROR_GENERICO }
  }
}

export interface Preferencias {
  acepta_novedades?: boolean
  recordar_carrito?: boolean
}

export async function guardarPreferencias(userId: string, cambios: Preferencias): Promise<Resultado> {
  try {
    const { error } = await supabase.from('profiles').update(cambios).eq('id', userId)
    if (error) {
      // Migración *_mi_cuenta / *_avisos_tienda sin aplicar: falta la columna.
      if (error.code === 'PGRST204' || error.code === '42703') {
        return { ok: false, error: 'Las preferencias todavía no están disponibles.' }
      }
      return { ok: false, error: ERROR_GENERICO }
    }
    return { ok: true, valor: true }
  } catch {
    return { ok: false, error: ERROR_GENERICO }
  }
}

// ---- Seguridad -----------------------------------------------------------------

/**
 * Cambia la contraseña. Primero comprueba la actual (volviendo a ingresar con
 * ella): así nadie con el celular desbloqueado puede cambiarla.
 */
export async function cambiarPassword(
  email: string,
  actual: string,
  nueva: string,
  repetida: string,
): Promise<Resultado> {
  const v = validarCambioPassword(actual, nueva, repetida)
  if (v) return { ok: false, error: v }
  try {
    const comprobacion = await supabase.auth.signInWithPassword({ email, password: actual })
    if (comprobacion.error) {
      const credenciales =
        comprobacion.error.code === 'invalid_credentials' || /invalid login/i.test(comprobacion.error.message)
      return {
        ok: false,
        error: credenciales ? 'La contraseña actual no es correcta.' : traducirErrorAuth(comprobacion.error) ?? ERROR_GENERICO,
      }
    }
    const { error } = await supabase.auth.updateUser({ password: nueva })
    if (error) return { ok: false, error: traducirErrorAuth(error) ?? ERROR_GENERICO }
    return { ok: true, valor: true }
  } catch {
    return { ok: false, error: ERROR_GENERICO }
  }
}

/**
 * Pide el cambio de email. Supabase manda un mail de confirmación (a la
 * dirección nueva y, si está activado "Secure email change", también a la
 * actual): el email cambia recién cuando se confirma.
 */
export async function cambiarEmail(nuevo: string, actual: string | null | undefined): Promise<Resultado<string>> {
  const v = validarNuevoEmail(nuevo, actual)
  if (v) return { ok: false, error: v }
  const email = nuevo.trim().toLowerCase()
  try {
    const { error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: `${window.location.origin}/mi-cuenta` },
    )
    if (error) {
      if (error.code === 'email_exists') return { ok: false, error: 'Ese email ya está usado por otra cuenta.' }
      return { ok: false, error: traducirErrorAuth(error) ?? ERROR_GENERICO }
    }
    return { ok: true, valor: email }
  } catch {
    return { ok: false, error: ERROR_GENERICO }
  }
}

// ---- Avisos de stock --------------------------------------------------------------

export interface MiAviso {
  productoId: string
  nombre: string
  slug: string | null
  imagen: string
  stock: number
  desde: string
}

/** Productos donde la clienta tocó "Avisame cuando vuelva" y todavía no se le avisó. */
export function normalizarMisAvisos(data: unknown): MiAviso[] {
  if (!Array.isArray(data)) return []
  const avisos: MiAviso[] = []
  for (const fila of data) {
    const f = (fila ?? {}) as Record<string, unknown>
    const p = f.productos as Record<string, unknown> | null | undefined
    if (typeof f.producto_id !== 'string' || !p || typeof p.nombre !== 'string') continue
    avisos.push({
      productoId: f.producto_id,
      nombre: p.nombre,
      slug: typeof p.slug === 'string' ? p.slug : null,
      imagen: portadaDe({ imagenes: (p.imagenes as string[] | null) ?? null, imagen_url: (p.imagen_url as string | null) ?? null }),
      stock: typeof p.stock === 'number' ? p.stock : 0,
      desde: typeof f.created_at === 'string' ? f.created_at : '',
    })
  }
  return avisos
}

export async function cargarMisAvisos(): Promise<Resultado<MiAviso[]>> {
  try {
    const { data, error } = await supabase
      .from('avisos_stock')
      .select('producto_id, created_at, productos(nombre, slug, stock, imagenes, imagen_url)')
      .is('notificado_at', null)
      .order('created_at', { ascending: false })
    if (error) return { ok: false, error: 'No pudimos cargar tus avisos.' }
    return { ok: true, valor: normalizarMisAvisos(data) }
  } catch {
    return { ok: false, error: 'No pudimos cargar tus avisos.' }
  }
}

// ---- Baja ----------------------------------------------------------------------------

export async function eliminarMiCuenta(): Promise<Resultado> {
  try {
    const { error } = await supabase.rpc('eliminar_mi_cuenta')
    if (error) {
      if (error.code === '42501' && error.message) return { ok: false, error: error.message }
      if (error.code === 'PGRST202') return { ok: false, error: 'Por ahora no se puede eliminar la cuenta desde acá. Escribinos por WhatsApp.' }
      return { ok: false, error: 'No pudimos eliminar la cuenta. Probá de nuevo en un rato.' }
    }
    await supabase.auth.signOut().catch(() => {})
    return { ok: true, valor: true }
  } catch {
    return { ok: false, error: 'No pudimos eliminar la cuenta. Probá de nuevo en un rato.' }
  }
}
