import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import type { MiembroEquipo, Rol } from '../types'

// Equipo del panel: lo gestiona la Edge Function gestionar-equipo (solo admin),
// porque invitar y cambiar roles necesita la service role key.

export const NOMBRE_FUNCION = 'gestionar-equipo'
export const MENSAJE_SIN_DESPLEGAR = 'Falta desplegar la función gestionar-equipo'

export type AccionEquipo =
  | { accion: 'listar' }
  | { accion: 'invitar'; email: string; nombre: string }
  | { accion: 'revocar'; user_id: string }

export type RespuestaEquipo<T> = { ok: true; datos: T } | { ok: false; mensaje: string }

const ROLES: Rol[] = ['cliente', 'empleado', 'admin']

export function normalizarMiembros(data: unknown): MiembroEquipo[] {
  // La función puede devolver el array directo o envuelto ({ miembros: [...] }).
  const lista = Array.isArray(data)
    ? data
    : Array.isArray((data as { miembros?: unknown } | null)?.miembros)
      ? (data as { miembros: unknown[] }).miembros
      : []
  return lista
    .map((x) => (x ?? {}) as Record<string, unknown>)
    .filter((x) => typeof x.id === 'string')
    .map((x) => ({
      id: x.id as string,
      email: typeof x.email === 'string' ? x.email : '',
      nombre: typeof x.nombre === 'string' && x.nombre.trim() ? x.nombre : null,
      rol: ROLES.includes(x.rol as Rol) ? (x.rol as Rol) : 'empleado',
      ultimo_ingreso: typeof x.ultimo_ingreso === 'string' ? x.ultimo_ingreso : null,
    }))
    .sort((a, b) => {
      // Admins primero; después por nombre/email.
      if (a.rol !== b.rol) return a.rol === 'admin' ? -1 : b.rol === 'admin' ? 1 : 0
      return (a.nombre ?? a.email).localeCompare(b.nombre ?? b.email, 'es')
    })
}

// Solo se revoca a empleados, y nunca a una misma.
export function puedeRevocar(miembro: Pick<MiembroEquipo, 'id' | 'rol'>, miId: string | null | undefined): boolean {
  return miembro.rol === 'empleado' && miembro.id !== miId
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validarInvitacion(datos: { email: string; nombre: string }): string | null {
  const email = datos.email.trim()
  if (!email) return 'Completá el email.'
  if (!EMAIL_RE.test(email)) return 'El email no parece válido.'
  if (!datos.nombre.trim()) return 'Completá el nombre.'
  if (datos.nombre.trim().length > 80) return 'El nombre es demasiado largo.'
  return null
}

export const MENSAJE_CONFIG_INVALIDA =
  'No se mandó la invitación: la dirección del panel está mal configurada. Revisá los secretos ' +
  'PUBLIC_ADMIN_URL y ADMIN_ORIGIN de la función gestionar-equipo (tienen que ser la misma dirección https ' +
  'del panel) y que esa dirección esté en Supabase → Authentication → URL Configuration → Redirect URLs.'

// Traduce la respuesta de error de la función (status + body) a un mensaje.
export function mensajeDeError(status: number | null, cuerpo: unknown): string {
  const b = (cuerpo ?? {}) as Record<string, unknown>
  // Configuración del link de invitación: mensaje fijo con qué revisar.
  if (b.codigo === 'config_invalida') return MENSAJE_CONFIG_INVALIDA
  const texto =
    typeof b.error === 'string'
      ? b.error
      : typeof b.mensaje === 'string'
        ? b.mensaje
        : typeof b.message === 'string'
          ? b.message
          : ''
  // El gateway de Supabase responde 404 NOT_FOUND si la función no existe.
  if (status === 404 && (!texto || /function was not found|not found/i.test(texto) || b.code === 'NOT_FOUND')) {
    return MENSAJE_SIN_DESPLEGAR
  }
  if (status === 401) return texto || 'Tu sesión venció. Volvé a ingresar.'
  if (status === 403) return texto || 'Solo una admin puede gestionar el equipo.'
  return texto || `La función respondió con un error${status ? ` (${status})` : ''}.`
}

async function leerCuerpo(respuesta: unknown): Promise<unknown> {
  if (!(respuesta instanceof Response)) return null
  try {
    return await respuesta.clone().json()
  } catch {
    try {
      return { error: await respuesta.text() }
    } catch {
      return null
    }
  }
}

async function invocar(body: AccionEquipo): Promise<RespuestaEquipo<unknown>> {
  const { data: sesion } = await supabase.auth.getSession()
  const token = sesion.session?.access_token
  if (!token) return { ok: false, mensaje: 'Tu sesión venció. Volvé a ingresar.' }
  try {
    const { data, error } = await supabase.functions.invoke(NOMBRE_FUNCION, {
      body,
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!error) return { ok: true, datos: data }
    if (error instanceof FunctionsHttpError) {
      const respuesta = error.context as Response | undefined
      return { ok: false, mensaje: mensajeDeError(respuesta?.status ?? null, await leerCuerpo(respuesta)) }
    }
    if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
      // Sin respuesta: función sin desplegar (CORS) o sin conexión.
      return { ok: false, mensaje: `${MENSAJE_SIN_DESPLEGAR} o no hay conexión.` }
    }
    return { ok: false, mensaje: error.message ?? 'Error desconocido.' }
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : 'Error desconocido.' }
  }
}

export async function listarEquipo(): Promise<RespuestaEquipo<MiembroEquipo[]>> {
  const r = await invocar({ accion: 'listar' })
  return r.ok ? { ok: true, datos: normalizarMiembros(r.datos) } : r
}

export type ResultadoInvitacion = 'invitada' | 'promovida' | 'sin_cambios'

export interface InvitacionHecha {
  resultado: ResultadoInvitacion | null
  // Origen al que lleva el link del mail (solo si se mandó una invitación).
  origenLink: string | null
}

const RESULTADOS: ResultadoInvitacion[] = ['invitada', 'promovida', 'sin_cambios']

export function leerInvitacion(data: unknown): InvitacionHecha {
  const d = (data ?? {}) as Record<string, unknown>
  return {
    resultado: RESULTADOS.includes(d.resultado as ResultadoInvitacion) ? (d.resultado as ResultadoInvitacion) : null,
    origenLink: typeof d.origen_link === 'string' && /^https?:\/\/\S+$/i.test(d.origen_link) ? d.origen_link : null,
  }
}

export async function invitarMiembro(email: string, nombre: string): Promise<RespuestaEquipo<InvitacionHecha>> {
  const r = await invocar({ accion: 'invitar', email: email.trim().toLowerCase(), nombre: nombre.trim() })
  return r.ok ? { ok: true, datos: leerInvitacion(r.datos) } : r
}

export async function revocarMiembro(userId: string): Promise<RespuestaEquipo<null>> {
  const r = await invocar({ accion: 'revocar', user_id: userId })
  return r.ok ? { ok: true, datos: null } : r
}
