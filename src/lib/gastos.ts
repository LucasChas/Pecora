import { supabase } from './supabaseClient'
import { aNumero, esErrorDeRed, esTablaInexistente, type ErrorSupabase } from './cupones'
import type { Rango } from './estadisticas'

// ============================================================================
// Gastos del negocio (tabla gastos, solo admin por RLS): compras de
// materiales, packaging, envíos y otros. Si la compra es para un producto y
// se indica para cuántas unidades alcanza, la base estima el costo por unidad
// (ver lib/rentabilidad y la RPC rentabilidad).
// ============================================================================

export type CategoriaGasto = 'materiales' | 'packaging' | 'envios' | 'otros'

export const CATEGORIAS_GASTO: { valor: CategoriaGasto; etiqueta: string }[] = [
  { valor: 'materiales', etiqueta: 'Materiales' },
  { valor: 'packaging', etiqueta: 'Packaging' },
  { valor: 'envios', etiqueta: 'Envíos' },
  { valor: 'otros', etiqueta: 'Otros' },
]

export function esCategoriaGasto(v: unknown): v is CategoriaGasto {
  return CATEGORIAS_GASTO.some((c) => c.valor === v)
}

export function etiquetaCategoria(c: CategoriaGasto): string {
  return CATEGORIAS_GASTO.find((x) => x.valor === c)?.etiqueta ?? c
}

export interface Gasto {
  id: string
  fecha: string // 'YYYY-MM-DD'
  concepto: string
  categoria: CategoriaGasto
  monto: number
  producto_id: string | null
  // Nombre actual del producto (null si no tiene o si se borró).
  producto_nombre: string | null
  cantidad: number | null
  notas: string | null
  created_at: string
}

export type DatosGasto = Omit<Gasto, 'id' | 'producto_nombre' | 'created_at'>

export interface ProductoOpcion {
  id: string
  nombre: string
}

export const MENSAJE_FALTA_MIGRACION_GASTOS = 'Falta aplicar la migración de gastos y rentabilidad en Supabase.'

export const LARGO_MAX_CONCEPTO = 200
export const LARGO_MAX_NOTAS = 1000
// numeric(12,2): hasta 9.999.999.999,99.
const MONTO_MAX = 9_999_999_999.99

// ---- Validación -------------------------------------------------------------

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

function esFechaValida(s: string): boolean {
  if (!RE_FECHA.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const f = new Date(y, m - 1, d)
  return f.getFullYear() === y && f.getMonth() === m - 1 && f.getDate() === d
}

// Devuelve el primer problema del formulario o null. Mismas reglas que los
// checks de la tabla, para avisar antes de ir a la base.
export function validarDatosGasto(d: DatosGasto): string | null {
  if (!esFechaValida(d.fecha)) return 'Elegí una fecha válida.'
  const concepto = d.concepto.trim()
  if (concepto === '') return 'Contá qué compraste (concepto).'
  if (concepto.length > LARGO_MAX_CONCEPTO) {
    return `El concepto puede tener hasta ${LARGO_MAX_CONCEPTO} caracteres.`
  }
  if (!esCategoriaGasto(d.categoria)) return 'Elegí una categoría.'
  if (!Number.isFinite(d.monto) || d.monto <= 0) return 'El monto tiene que ser mayor a 0.'
  if (d.monto > MONTO_MAX) return 'El monto es demasiado grande.'
  if (d.cantidad !== null) {
    if (!d.producto_id) return 'Para indicar la cantidad, elegí el producto.'
    if (!Number.isInteger(d.cantidad) || d.cantidad < 1) {
      return 'La cantidad tiene que ser un número entero mayor a 0.'
    }
  }
  if (d.notas && d.notas.trim().length > LARGO_MAX_NOTAS) {
    return `Las notas pueden tener hasta ${LARGO_MAX_NOTAS} caracteres.`
  }
  return null
}

// Costo por unidad de una compra (monto / cantidad), o null si no aplica.
export function costoPorUnidad(monto: number, cantidad: number | null): number | null {
  if (!(monto > 0) || cantidad === null || !(cantidad > 0)) return null
  return monto / cantidad
}

export function totalGastos(gastos: Pick<Gasto, 'monto'>[]): number {
  return gastos.reduce((s, g) => s + g.monto, 0)
}

// ---- Normalización ------------------------------------------------------------

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function textoONull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

// Fila tal como llega de PostgREST (montos como texto, producto embebido).
export function normalizarGasto(fila: unknown): Gasto | null {
  const f = objeto(fila)
  if (typeof f.id !== 'string') return null
  // El producto embebido puede venir como objeto o como arreglo de uno.
  const producto = objeto(Array.isArray(f.producto) ? f.producto[0] : f.producto)
  const cantidad = f.cantidad === null || f.cantidad === undefined ? null : aNumero(f.cantidad)
  return {
    id: f.id,
    fecha: typeof f.fecha === 'string' ? f.fecha.slice(0, 10) : '',
    concepto: typeof f.concepto === 'string' ? f.concepto : '',
    categoria: esCategoriaGasto(f.categoria) ? f.categoria : 'otros',
    monto: aNumero(f.monto),
    producto_id: typeof f.producto_id === 'string' ? f.producto_id : null,
    producto_nombre: textoONull(producto.nombre),
    cantidad: cantidad !== null && cantidad > 0 ? cantidad : null,
    notas: textoONull(f.notas),
    created_at: typeof f.created_at === 'string' ? f.created_at : '',
  }
}

// ---- Acceso a datos -------------------------------------------------------------

export type ResultadoGastos =
  | { ok: true; datos: Gasto[] }
  | { ok: false; faltaMigracion: boolean; mensaje: string }

export function mensajeErrorGasto(error: ErrorSupabase): string {
  if (esTablaInexistente(error)) return MENSAJE_FALTA_MIGRACION_GASTOS
  if (esErrorDeRed(error)) return 'No hay conexión. Revisá internet y volvé a intentar.'
  if (error.code === '42501') return 'Tu usuario no tiene permiso para cargar gastos.'
  if (error.code === '23514') return 'Revisá los valores: alguno está fuera de rango.'
  if (error.code === '23503') return 'El producto elegido ya no existe.'
  return error.message || 'No se pudo guardar el gasto.'
}

const COLUMNAS = 'id, fecha, concepto, categoria, monto, producto_id, cantidad, notas, created_at, producto:productos(nombre)'

// Gastos con fecha dentro del rango (inclusive), del más nuevo al más viejo.
export async function listarGastos(rango: Rango): Promise<ResultadoGastos> {
  try {
    const { data, error } = await supabase
      .from('gastos')
      .select(COLUMNAS)
      .gte('fecha', rango.desde)
      .lte('fecha', rango.hasta)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) {
      console.error('[gastos]', error)
      const faltaMigracion = esTablaInexistente(error)
      return {
        ok: false,
        faltaMigracion,
        mensaje: faltaMigracion ? MENSAJE_FALTA_MIGRACION_GASTOS : mensajeErrorGasto(error),
      }
    }
    const gastos = ((data ?? []) as unknown[]).map(normalizarGasto).filter((g): g is Gasto => g !== null)
    return { ok: true, datos: gastos }
  } catch (e) {
    console.error('[gastos]', e)
    return { ok: false, faltaMigracion: false, mensaje: 'No hay conexión. Revisá internet y volvé a intentar.' }
  }
}

// Lo que se manda a la tabla: textos recortados, cantidad solo con producto.
export function filaDeGasto(d: DatosGasto): DatosGasto {
  return {
    fecha: d.fecha,
    concepto: d.concepto.trim(),
    categoria: d.categoria,
    monto: Math.round(d.monto * 100) / 100,
    producto_id: d.producto_id || null,
    cantidad: d.producto_id ? d.cantidad : null,
    notas: d.notas?.trim() ? d.notas.trim() : null,
  }
}

// Alta (sin id) o edición. Devuelve el mensaje de error o null.
// Se pide la fila de vuelta: un update o delete bloqueado por RLS no da error,
// solo afecta 0 filas (CONTEXTO §12.10).
export async function guardarGasto(datos: DatosGasto, id?: string): Promise<string | null> {
  const fila = filaDeGasto(datos)
  try {
    const { data, error } = id
      ? await supabase.from('gastos').update(fila).eq('id', id).select('id')
      : await supabase.from('gastos').insert(fila).select('id')
    if (error) return mensajeErrorGasto(error)
    if (!data || data.length === 0) return 'No se pudo guardar el gasto (puede que ya no exista).'
    return null
  } catch {
    return 'No hay conexión. Revisá internet y volvé a intentar.'
  }
}

export async function borrarGasto(id: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('gastos').delete().eq('id', id).select('id')
    if (error) return mensajeErrorGasto(error)
    if (!data || data.length === 0) return 'No se pudo borrar el gasto (puede que ya no exista).'
    return null
  } catch {
    return 'No hay conexión. Revisá internet y volvé a intentar.'
  }
}

// Productos para el selector del formulario. Si falla, lista vacía: el gasto
// se puede cargar igual como gasto general.
export async function listarProductosParaGastos(): Promise<ProductoOpcion[]> {
  try {
    const { data, error } = await supabase.from('productos').select('id, nombre').order('nombre')
    if (error) {
      console.error('[gastos] productos', error)
      return []
    }
    return ((data ?? []) as { id: string; nombre: string }[]).filter((p) => typeof p.id === 'string')
  } catch (e) {
    console.error('[gastos] productos', e)
    return []
  }
}
