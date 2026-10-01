import { supabase } from './supabaseClient'
import { money } from './format'
import type { Cupon, TipoCupon } from '../types'

// ============================================================================
// Cupones de descuento: validación en el checkout (RPC validar_cupon) y ABM
// del panel (tabla cupones, solo admin por RLS).
// La base es la fuente de verdad: crear_pedido vuelve a validar el cupón y
// calcula el descuento. Lo de acá es para mostrar una estimación.
// ============================================================================

const PREFIJO_LOG = '[cupones]'

export interface ErrorSupabase {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

function textoDelError(error: ErrorSupabase): string {
  return [error.message, error.details, error.hint].filter(Boolean).join(' ')
}

// ¿La función RPC `nombre` no existe (todavía no se aplicó la migración)?
// PGRST202 de PostgREST o 42883 (undefined_function) de Postgres.
export function esFuncionInexistente(error: ErrorSupabase, nombre: string): boolean {
  if (error.code === 'PGRST202' || error.code === '42883') return true
  const texto = textoDelError(error)
  return new RegExp(nombre, 'i').test(texto) && /could not find|does not exist|schema cache/i.test(texto)
}

// ¿La tabla no existe? 42P01 (undefined_table) de Postgres o PGRST205 de
// PostgREST ("Could not find the table ... in the schema cache").
export function esTablaInexistente(error: ErrorSupabase): boolean {
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(textoDelError(error))
}

// Fallo de conexión (sin respuesta del servidor).
export function esErrorDeRed(error: ErrorSupabase): boolean {
  return !error.code && /failed to fetch|networkerror|network request failed|load failed/i.test(error.message ?? '')
}

export const MENSAJE_FALTA_MIGRACION = 'Falta aplicar la migración de cupones/envíos en Supabase.'

// Monto que puede llegar como número o texto (numeric de Postgres).
export function aNumero(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

// Un RPC que devuelve una fila puede llegar como objeto o como arreglo de una.
export function primeraFila(data: unknown): Record<string, unknown> | null {
  const fila = Array.isArray(data) ? data[0] : data
  return fila && typeof fila === 'object' ? (fila as Record<string, unknown>) : null
}

// Código tal como lo guarda la base: sin espacios y en mayúsculas.
export function normalizarCodigo(codigo: string): string {
  return codigo.replace(/\s+/g, '').toUpperCase()
}

// ---- Validación en el checkout ----------------------------------------------

export interface ResultadoCupon {
  valido: boolean
  codigo: string
  tipo: TipoCupon | null
  // Descuento estimado en pesos (0 para envío gratis).
  descuento: number
  envioGratis: boolean
  // Explicación para la clienta (por qué no aplica, o qué hace el cupón).
  mensaje: string | null
  // false si la base todavía no tiene cupones (falta la migración).
  disponible: boolean
}

const TIPOS: readonly TipoCupon[] = ['porcentaje', 'monto', 'envio_gratis']

function resultadoInvalido(codigo: string, mensaje: string, disponible = true): ResultadoCupon {
  return { valido: false, codigo, tipo: null, descuento: 0, envioGratis: false, mensaje, disponible }
}

// Valida un código contra el subtotal actual (RPC validar_cupon, requiere
// sesión). Nunca lanza: los errores vuelven como resultado inválido con un
// mensaje para mostrar.
// pedidoManual = true: vista previa de un pedido manual de la admin (sin los
// chequeos por clienta, igual que crear_pedido con origen 'admin'). La base lo
// ignora si quien llama no es admin. En el checkout no se manda el parámetro.
export async function validarCupon(
  codigo: string,
  subtotal: number,
  opciones: { pedidoManual?: boolean } = {},
): Promise<ResultadoCupon> {
  const limpio = normalizarCodigo(codigo)
  if (limpio === '') return resultadoInvalido(limpio, 'Ingresá el código del cupón.')

  const params: { p_codigo: string; p_subtotal: number; p_pedido_manual?: boolean } = {
    p_codigo: limpio,
    p_subtotal: subtotal,
  }
  if (opciones.pedidoManual === true) params.p_pedido_manual = true

  let respuesta: { data: unknown; error: ErrorSupabase | null }
  try {
    respuesta = await supabase.rpc('validar_cupon', params)
  } catch {
    return resultadoInvalido(limpio, 'No pudimos validar el cupón. Revisá tu conexión y probá de nuevo.')
  }
  const { data, error } = respuesta
  if (error) {
    if (esFuncionInexistente(error, 'validar_cupon')) {
      console.warn(`${PREFIJO_LOG} validar_cupon no existe todavía (falta la migración).`, error.message)
      return resultadoInvalido(limpio, 'Los cupones todavía no están disponibles.', false)
    }
    if (esErrorDeRed(error)) {
      return resultadoInvalido(limpio, 'No pudimos validar el cupón. Revisá tu conexión y probá de nuevo.')
    }
    return resultadoInvalido(limpio, error.message || 'No pudimos validar el cupón.')
  }

  const fila = primeraFila(data)
  if (!fila) return resultadoInvalido(limpio, 'No pudimos validar el cupón.')
  const valido = fila.valido === true
  const tipo = TIPOS.includes(fila.tipo as TipoCupon) ? (fila.tipo as TipoCupon) : null
  const mensaje = typeof fila.mensaje === 'string' && fila.mensaje.trim() !== '' ? fila.mensaje : null
  const codigoBase = typeof fila.codigo === 'string' && fila.codigo !== '' ? fila.codigo : limpio
  if (!valido) return resultadoInvalido(codigoBase, mensaje ?? 'El cupón no es válido.')
  return {
    valido: true,
    codigo: codigoBase,
    tipo,
    descuento: Math.max(0, Math.min(aNumero(fila.descuento), subtotal)),
    envioGratis: fila.envio_gratis === true || tipo === 'envio_gratis',
    mensaje,
    disponible: true,
  }
}

// ---- Panel: estado y descripción ------------------------------------------------

export type EstadoCupon = 'activo' | 'inactivo' | 'programado' | 'vencido' | 'agotado'

export const TEXTO_ESTADO_CUPON: Record<EstadoCupon, string> = {
  activo: 'Activo',
  inactivo: 'Pausado',
  programado: 'Programado',
  vencido: 'Vencido',
  agotado: 'Agotado',
}

// Estado de un cupón para el chip del panel. Prioridad: pausado a mano >
// vencido > agotado > todavía no empezó > activo.
export function estadoCupon(
  cupon: Pick<Cupon, 'activo' | 'desde' | 'hasta' | 'usos_max'>,
  usos: number,
  ahora: number = Date.now(),
): EstadoCupon {
  if (!cupon.activo) return 'inactivo'
  if (cupon.hasta && Date.parse(cupon.hasta) < ahora) return 'vencido'
  if (cupon.usos_max !== null && cupon.usos_max !== undefined && usos >= cupon.usos_max) return 'agotado'
  if (cupon.desde && Date.parse(cupon.desde) > ahora) return 'programado'
  return 'activo'
}

// "10% off", "$ 1.500 off" o "Envío gratis".
export function describirCupon(cupon: Pick<Cupon, 'tipo' | 'valor'>): string {
  if (cupon.tipo === 'porcentaje') return `${aNumero(cupon.valor)}% off`
  if (cupon.tipo === 'monto') return `${money(aNumero(cupon.valor))} off`
  return 'Envío gratis'
}

// ---- Panel: ABM ------------------------------------------------------------------

export interface CuponConUsos extends Cupon {
  usos: number
}

export type ResultadoCarga<T> =
  | { ok: true; datos: T }
  | { ok: false; faltaMigracion: boolean; mensaje: string }

function falla<T>(error: ErrorSupabase): ResultadoCarga<T> {
  const faltaMigracion = esTablaInexistente(error)
  return {
    ok: false,
    faltaMigracion,
    mensaje: faltaMigracion ? MENSAJE_FALTA_MIGRACION : error.message || 'No se pudo cargar.',
  }
}

// Cupones con la cantidad de usos (tabla cupon_usos, lectura solo admin).
export async function listarCupones(): Promise<ResultadoCarga<CuponConUsos[]>> {
  const [cupones, usos] = await Promise.all([
    supabase.from('cupones').select('*').order('created_at', { ascending: false }),
    supabase.from('cupon_usos').select('cupon_id'),
  ])
  if (cupones.error) return falla(cupones.error)
  const conteo = new Map<string, number>()
  // Sin la tabla de usos se muestran en 0 en vez de bloquear la lista.
  for (const u of (usos.error ? [] : usos.data ?? []) as { cupon_id: string }[]) {
    conteo.set(u.cupon_id, (conteo.get(u.cupon_id) ?? 0) + 1)
  }
  const lista = ((cupones.data ?? []) as Cupon[]).map((c) => ({ ...c, usos: conteo.get(c.id) ?? 0 }))
  return { ok: true, datos: lista }
}

export type DatosCupon = Omit<Cupon, 'id' | 'created_at'>

// Mensaje legible para errores de guardado (código repetido, etc.).
export function mensajeErrorCupon(error: ErrorSupabase): string {
  if (esTablaInexistente(error)) return MENSAJE_FALTA_MIGRACION
  if (error.code === '23505') return 'Ya existe un cupón con ese código.'
  if (error.code === '23514') return 'Revisá los valores: alguno está fuera de rango.'
  return error.message || 'No se pudo guardar el cupón.'
}

export async function guardarCupon(datos: DatosCupon, id?: string): Promise<string | null> {
  const guardar = (fila: Record<string, unknown>) =>
    id ? supabase.from('cupones').update(fila).eq('id', id) : supabase.from('cupones').insert(fila)
  const fila: Record<string, unknown> = { ...datos, codigo: normalizarCodigo(datos.codigo) }
  let { error } = await guardar(fila)
  // Sin la migración *_cupones_visibles la columna no existe: se guarda el resto.
  if (error && (error.code === 'PGRST204' || error.code === '42703') && 'visible_en_cuenta' in fila) {
    delete fila.visible_en_cuenta
    ;({ error } = await guardar(fila))
  }
  return error ? mensajeErrorCupon(error) : null
}

// ---- Cupones que ve la clienta en "Mi cuenta" ----------------------------------

export interface CuponDisponible {
  codigo: string
  descripcion: string | null
  tipo: TipoCupon
  valor: number
  minimoCompra: number
  hasta: string | null
  soloPrimeraCompra: boolean
}

/** "10 % de descuento" / "$ 500 de descuento" / "Envío gratis". */
export function textoBeneficio(c: Pick<CuponDisponible, 'tipo' | 'valor'>): string {
  if (c.tipo === 'envio_gratis') return 'Envío gratis'
  if (c.tipo === 'porcentaje') return `${aNumero(c.valor).toLocaleString('es-AR')} % de descuento`
  return `${money(aNumero(c.valor))} de descuento`
}

export function normalizarCuponesDisponibles(data: unknown): CuponDisponible[] {
  if (!Array.isArray(data)) return []
  const lista: CuponDisponible[] = []
  for (const fila of data) {
    const f = (fila ?? {}) as Record<string, unknown>
    if (typeof f.codigo !== 'string' || !['porcentaje', 'monto', 'envio_gratis'].includes(f.tipo as string)) continue
    lista.push({
      codigo: f.codigo,
      descripcion: typeof f.descripcion === 'string' && f.descripcion.trim() ? f.descripcion.trim() : null,
      tipo: f.tipo as TipoCupon,
      valor: aNumero(f.valor),
      minimoCompra: aNumero(f.minimo_compra),
      hasta: typeof f.hasta === 'string' ? f.hasta : null,
      soloPrimeraCompra: f.solo_primera_compra === true,
    })
  }
  return lista
}

/** Cupones visibles que la cuenta logueada puede usar hoy. [] si falla o falta la migración. */
export async function cargarCuponesDisponibles(): Promise<CuponDisponible[]> {
  try {
    const { data, error } = await supabase.rpc('cupones_disponibles')
    if (error) return []
    return normalizarCuponesDisponibles(data)
  } catch {
    return []
  }
}

// Pausa / reactiva un cupón sin tocar el resto de sus datos.
export async function activarCupon(id: string, activo: boolean): Promise<string | null> {
  const { error } = await supabase.from('cupones').update({ activo }).eq('id', id)
  return error ? mensajeErrorCupon(error) : null
}

export async function borrarCupon(id: string): Promise<string | null> {
  const { error } = await supabase.from('cupones').delete().eq('id', id)
  if (!error) return null
  return mensajeErrorCupon(error)
}

// Valida el formulario del panel. Devuelve el primer problema o null.
export function validarDatosCupon(d: DatosCupon): string | null {
  const codigo = normalizarCodigo(d.codigo)
  if (codigo.length < 3) return 'El código tiene que tener al menos 3 caracteres.'
  if (!/^[A-Z0-9_-]+$/.test(codigo)) return 'El código solo puede tener letras, números, - y _.'
  if (d.tipo === 'porcentaje' && !(d.valor > 0 && d.valor <= 100)) return 'El porcentaje va de 1 a 100.'
  if (d.tipo === 'monto' && !(d.valor > 0)) return 'El monto del descuento tiene que ser mayor a 0.'
  if (!(d.minimo_compra >= 0)) return 'El mínimo de compra no puede ser negativo.'
  if (d.usos_max !== null && !(Number.isInteger(d.usos_max) && d.usos_max >= 1)) {
    return 'Los usos máximos tienen que ser un número entero mayor a 0.'
  }
  if (d.usos_por_cliente !== null && !(Number.isInteger(d.usos_por_cliente) && d.usos_por_cliente >= 1)) {
    return 'Los usos por clienta tienen que ser un número entero mayor a 0.'
  }
  if (d.desde && d.hasta && Date.parse(d.hasta) <= Date.parse(d.desde)) {
    return 'La fecha de fin es anterior a la de inicio.'
  }
  return null
}
