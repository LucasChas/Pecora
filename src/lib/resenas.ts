import { supabase } from './supabaseClient'
import { aNumero, primeraFila } from './cupones'
import type { MiResena, Resena, ResenaModeracion, ResumenResenas } from '../types'

// ============================================================================
// Reseñas con estrellas de compradoras verificadas (migración *_resenas.sql).
//
// Todo pasa por RPCs: la base decide quién puede opinar (pedido propio no
// cancelado ni en la papelera que incluya el producto) y nunca devuelve
// emails ni ids de cuenta, solo el primer nombre. Las funciones de acá nunca
// lanzan: devuelven un resultado con un mensaje listo para mostrar. Si la
// migración todavía no está aplicada, la sección simplemente no aparece
// (igual que "Lo más vendido").
// ============================================================================

const PREFIJO_LOG = '[resenas]'

export const MAX_COMENTARIO = 1000
export const MIN_ESTRELLAS = 1
export const MAX_ESTRELLAS = 5

export const MENSAJE_NO_DISPONIBLE = 'Las reseñas todavía no están disponibles.'
export const MENSAJE_ERROR_GENERICO = 'No pudimos procesar la reseña. Probá de nuevo en un rato.'

interface ErrorSupabase {
  code?: string
  message?: string
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string; noDisponible?: boolean }

// ---- Validación (misma regla que la base) ---------------------------------

export type ValidacionResena =
  | { ok: true; estrellas: number; comentario: string | null }
  | { ok: false; error: string }

/** Estrellas enteras de 1 a 5; comentario opcional, sin espacios en los extremos. */
export function validarResena(estrellas: number | null | undefined, comentario: string | null | undefined): ValidacionResena {
  if (
    typeof estrellas !== 'number' ||
    !Number.isInteger(estrellas) ||
    estrellas < MIN_ESTRELLAS ||
    estrellas > MAX_ESTRELLAS
  ) {
    return { ok: false, error: 'Elegí entre 1 y 5 estrellas.' }
  }
  const texto = (comentario ?? '').trim()
  if (texto.length > MAX_COMENTARIO) {
    return { ok: false, error: `El comentario puede tener hasta ${MAX_COMENTARIO} caracteres.` }
  }
  return { ok: true, estrellas, comentario: texto === '' ? null : texto }
}

// ---- Normalización de lo que devuelven los RPCs ---------------------------

function texto(valor: unknown): string | null {
  return typeof valor === 'string' ? valor : null
}

function estrellasValidas(valor: unknown): number | null {
  const n = aNumero(valor)
  return Number.isInteger(n) && n >= MIN_ESTRELLAS && n <= MAX_ESTRELLAS ? n : null
}

/** Filas de resenas_de_producto; descarta las mal formadas. */
export function normalizarResenas(data: unknown): Resena[] {
  if (!Array.isArray(data)) return []
  const filas: Resena[] = []
  for (const fila of data) {
    if (!fila || typeof fila !== 'object') continue
    const f = fila as Record<string, unknown>
    const id = texto(f.id)
    const estrellas = estrellasValidas(f.estrellas)
    if (!id || estrellas === null) continue
    filas.push({
      id,
      estrellas,
      comentario: texto(f.comentario),
      nombre_corto: texto(f.nombre_corto)?.trim() || 'Cliente',
      created_at: texto(f.created_at) ?? '',
      updated_at: texto(f.updated_at) ?? texto(f.created_at) ?? '',
      es_mia: f.es_mia === true,
    })
  }
  return filas
}

/** Fila de resumen_resenas (llega como objeto o como arreglo de una). */
export function normalizarResumen(data: unknown): ResumenResenas {
  const fila = primeraFila(data)
  const cantidad = Math.max(0, Math.trunc(aNumero(fila?.cantidad)))
  const promedio = fila?.promedio === null || fila?.promedio === undefined ? null : aNumero(fila.promedio)
  return { cantidad, promedio: cantidad > 0 && promedio !== null && promedio > 0 ? promedio : null }
}

/** Fila de mi_resena, o null si no tiene. */
export function normalizarMiResena(data: unknown): MiResena | null {
  const f = primeraFila(data)
  const id = texto(f?.id)
  const estrellas = estrellasValidas(f?.estrellas)
  if (!f || !id || estrellas === null) return null
  return {
    id,
    estrellas,
    comentario: texto(f.comentario),
    oculta: f.oculta === true,
    created_at: texto(f.created_at) ?? '',
    updated_at: texto(f.updated_at) ?? texto(f.created_at) ?? '',
  }
}

/** Filas de resenas_moderacion. */
export function normalizarModeracion(data: unknown): ResenaModeracion[] {
  if (!Array.isArray(data)) return []
  const filas: ResenaModeracion[] = []
  for (const fila of data) {
    if (!fila || typeof fila !== 'object') continue
    const f = fila as Record<string, unknown>
    const id = texto(f.id)
    const productoId = texto(f.producto_id)
    const estrellas = estrellasValidas(f.estrellas)
    if (!id || !productoId || estrellas === null) continue
    filas.push({
      id,
      producto_id: productoId,
      producto_nombre: texto(f.producto_nombre) ?? 'Producto',
      producto_slug: texto(f.producto_slug),
      estrellas,
      comentario: texto(f.comentario),
      nombre_corto: texto(f.nombre_corto)?.trim() || 'Cliente',
      oculta: f.oculta === true,
      created_at: texto(f.created_at) ?? '',
    })
  }
  return filas
}

// ---- Presentación ----------------------------------------------------------

/** Promedio con un decimal y coma: 4.25 -> "4,3". Sin reseñas: "". */
export function formatearPromedio(promedio: number | null | undefined): string {
  if (typeof promedio !== 'number' || !Number.isFinite(promedio) || promedio <= 0) return ''
  const acotado = Math.min(MAX_ESTRELLAS, Math.max(MIN_ESTRELLAS, promedio))
  return acotado.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/** "1 reseña" / "3 reseñas" / "Sin reseñas". */
export function textoCantidad(cantidad: number): string {
  if (!Number.isFinite(cantidad) || cantidad <= 0) return 'Sin reseñas'
  return cantidad === 1 ? '1 reseña' : `${cantidad} reseñas`
}

/**
 * Estrellas a pintar para un promedio, redondeado a la media estrella más
 * cercana: 4,3 -> 4,5 -> { llenas: 4, media: true }.
 */
export function estrellasDePromedio(promedio: number | null | undefined): { llenas: number; media: boolean } {
  if (typeof promedio !== 'number' || !Number.isFinite(promedio) || promedio <= 0) {
    return { llenas: 0, media: false }
  }
  const redondeado = Math.round(Math.min(MAX_ESTRELLAS, promedio) * 2) / 2
  const llenas = Math.floor(redondeado)
  return { llenas, media: redondeado - llenas === 0.5 }
}

/** Texto accesible de una calificación: "4 de 5 estrellas". */
export function textoEstrellas(estrellas: number): string {
  return estrellas === 1 ? '1 de 5 estrellas' : `${estrellas} de 5 estrellas`
}

/** Fecha corta en castellano: "28 de septiembre de 2026". */
export function formatearFechaResena(iso: string): string {
  const fecha = new Date(iso)
  if (!iso || Number.isNaN(fecha.getTime())) return ''
  return fecha.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ---- Errores ---------------------------------------------------------------

/** El RPC o la tabla no existen (migración sin aplicar en este ambiente). */
export function faltaMigracion(error: ErrorSupabase | null | undefined): boolean {
  const code = error?.code
  return code === 'PGRST202' || code === 'PGRST205' || code === '42883' || code === '42P01'
}

/**
 * Mensaje para mostrar. Los errores que levantan los RPCs a propósito
 * (42501 sin permiso, 22023 dato inválido, P0001/P0002) ya vienen en
 * castellano y se muestran tal cual. 42501 sin mensaje propio = sin sesión.
 */
export function mensajeDeError(error: ErrorSupabase | null | undefined): string {
  if (faltaMigracion(error)) return MENSAJE_NO_DISPONIBLE
  const code = error?.code
  const msg = error?.message?.trim()
  if (code === '42501' && (!msg || /permission denied/i.test(msg))) {
    return 'Tenés que ingresar a tu cuenta.'
  }
  if ((code === '42501' || code === '22023' || code === 'P0001' || code === 'P0002') && msg) {
    return msg
  }
  return MENSAJE_ERROR_GENERICO
}

function fallo<T>(accion: string, error: unknown): Resultado<T> {
  const e = (error ?? {}) as ErrorSupabase
  if (faltaMigracion(e)) {
    console.warn(`${PREFIJO_LOG} ${accion}: no disponible`, e.message)
    return { ok: false, error: MENSAJE_NO_DISPONIBLE, noDisponible: true }
  }
  console.error(`${PREFIJO_LOG} ${accion}:`, e.message ?? error)
  return { ok: false, error: mensajeDeError(e) }
}

// ---- Llamadas --------------------------------------------------------------

export interface ResenasProducto {
  resumen: ResumenResenas
  resenas: Resena[]
}

/** Reseñas visibles y resumen de un producto (público). */
export async function cargarResenas(productoId: string): Promise<Resultado<ResenasProducto>> {
  try {
    const [lista, resumen] = await Promise.all([
      supabase.rpc('resenas_de_producto', { p_producto_id: productoId }),
      supabase.rpc('resumen_resenas', { p_producto_id: productoId }),
    ])
    if (lista.error) return fallo('cargarResenas', lista.error)
    if (resumen.error) return fallo('cargarResenas', resumen.error)
    return {
      ok: true,
      valor: { resenas: normalizarResenas(lista.data), resumen: normalizarResumen(resumen.data) },
    }
  } catch (e) {
    return fallo('cargarResenas', e)
  }
}

export interface EstadoPropio {
  puede: boolean
  mia: MiResena | null
}

/** Para la clienta logueada: si puede opinar y su reseña actual. */
export async function cargarEstadoPropio(productoId: string): Promise<Resultado<EstadoPropio>> {
  try {
    const [puede, mia] = await Promise.all([
      supabase.rpc('puede_resenar', { p_producto_id: productoId }),
      supabase.rpc('mi_resena', { p_producto_id: productoId }),
    ])
    if (puede.error) return fallo('cargarEstadoPropio', puede.error)
    if (mia.error) return fallo('cargarEstadoPropio', mia.error)
    return { ok: true, valor: { puede: puede.data === true, mia: normalizarMiResena(mia.data) } }
  } catch (e) {
    return fallo('cargarEstadoPropio', e)
  }
}

/** Crea o edita la reseña propia (valida antes de llamar a la base). */
export async function guardarResena(
  productoId: string,
  estrellas: number | null,
  comentario: string | null,
): Promise<Resultado<string>> {
  const v = validarResena(estrellas, comentario)
  if (!v.ok) return { ok: false, error: v.error }
  try {
    const { data, error } = await supabase.rpc('guardar_resena', {
      p_producto_id: productoId,
      p_estrellas: v.estrellas,
      p_comentario: v.comentario,
    })
    if (error) return fallo('guardarResena', error)
    if (typeof data !== 'string' || !data) return fallo('guardarResena', { message: 'respuesta vacía' })
    return { ok: true, valor: data }
  } catch (e) {
    return fallo('guardarResena', e)
  }
}

/** Borra la reseña propia. `valor` es false si no había ninguna. */
export async function borrarResena(productoId: string): Promise<Resultado<boolean>> {
  try {
    const { data, error } = await supabase.rpc('borrar_resena', { p_producto_id: productoId })
    if (error) return fallo('borrarResena', error)
    return { ok: true, valor: data === true }
  } catch (e) {
    return fallo('borrarResena', e)
  }
}

/** Panel: lista para moderar (solo admin). */
export async function listarResenasModeracion(soloOcultas = false): Promise<Resultado<ResenaModeracion[]>> {
  try {
    const { data, error } = await supabase.rpc('resenas_moderacion', {
      p_solo_ocultas: soloOcultas,
      p_limite: 200,
    })
    if (error) return fallo('listarResenasModeracion', error)
    return { ok: true, valor: normalizarModeracion(data) }
  } catch (e) {
    return fallo('listarResenasModeracion', e)
  }
}

/** Panel: oculta o vuelve a mostrar una reseña. `valor` es false si ya no existe. */
export async function ocultarResena(id: string, oculta: boolean): Promise<Resultado<boolean>> {
  try {
    const { data, error } = await supabase.rpc('ocultar_resena', { p_id: id, p_oculta: oculta })
    if (error) return fallo('ocultarResena', error)
    return { ok: true, valor: data === true }
  } catch (e) {
    return fallo('ocultarResena', e)
  }
}

/** Reseña propia junto al producto al que pertenece (mis_resenas). */
export interface MiResenaDeProducto extends MiResena {
  producto_id: string
}

/** Todas las reseñas de la cuenta logueada, en una sola llamada. */
export async function cargarMisResenas(): Promise<Resultado<MiResenaDeProducto[]>> {
  try {
    const { data, error } = await supabase.rpc('mis_resenas')
    if (error) return fallo('cargarMisResenas', error)
    const filas: MiResenaDeProducto[] = []
    for (const fila of Array.isArray(data) ? data : []) {
      const productoId = texto((fila as Record<string, unknown> | null)?.producto_id)
      const mia = normalizarMiResena(fila)
      if (productoId && mia) filas.push({ ...mia, producto_id: productoId })
    }
    return { ok: true, valor: filas }
  } catch (e) {
    return fallo('cargarMisResenas', e)
  }
}

/**
 * Promedio y cantidad de reseñas visibles por producto, para las cards del
 * muestrario. Se agrupa acá: la tabla se puede leer (RLS: solo las visibles
 * para el público) sin user_id. Se filtra `oculta` igual, porque el staff
 * también ve las ocultas.
 */
export function agruparResumenes(filas: unknown): Map<string, ResumenResenas> {
  const sumas = new Map<string, { total: number; cantidad: number }>()
  for (const fila of Array.isArray(filas) ? filas : []) {
    const f = (fila ?? {}) as Record<string, unknown>
    const productoId = texto(f.producto_id)
    const estrellas = estrellasValidas(f.estrellas)
    if (!productoId || estrellas === null || f.oculta === true) continue
    const s = sumas.get(productoId) ?? { total: 0, cantidad: 0 }
    s.total += estrellas
    s.cantidad += 1
    sumas.set(productoId, s)
  }
  const mapa = new Map<string, ResumenResenas>()
  for (const [id, s] of sumas) {
    mapa.set(id, { cantidad: s.cantidad, promedio: Math.round((s.total / s.cantidad) * 10) / 10 })
  }
  return mapa
}

export async function cargarResumenesResenas(): Promise<Resultado<Map<string, ResumenResenas>>> {
  try {
    const { data, error } = await supabase
      .from('resenas')
      .select('producto_id, estrellas, oculta')
      .eq('oculta', false)
      .limit(5000)
    if (error) return fallo('cargarResumenesResenas', error)
    return { ok: true, valor: agruparResumenes(data) }
  } catch (e) {
    return fallo('cargarResumenesResenas', e)
  }
}
