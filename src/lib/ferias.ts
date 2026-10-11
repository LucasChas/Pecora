import { supabase } from './supabaseClient'
import { esErrorDeRed, esFuncionInexistente, esTablaInexistente, type ErrorSupabase } from './cupones'
import type { ItemNuevoPedido } from './orders'
import type { MedioPago } from '../types'

// ============================================================================
// Ventas en la feria (migración *_ventas_feria). Se cargan desde "Nuevo
// pedido" en modo Feria: sin datos de la clienta, con la feria (nombre +
// fecha) y el medio de pago. Cada clienta que compra es un pedido con origen
// 'feria'; la base descuenta el stock y lo deja entregado y pagado.
// ============================================================================

export interface Feria {
  id: string
  nombre: string
  fecha: string // 'YYYY-MM-DD'
  activa: boolean
}

export const MEDIOS_PAGO: { valor: MedioPago; etiqueta: string }[] = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'mercadopago', etiqueta: 'Mercado Pago' },
]

export function esMedioPago(v: unknown): v is MedioPago {
  return MEDIOS_PAGO.some((m) => m.valor === v)
}

export function etiquetaMedioPago(m: MedioPago | null | undefined): string {
  return MEDIOS_PAGO.find((x) => x.valor === m)?.etiqueta ?? ''
}

export const MENSAJE_FALTA_MIGRACION_FERIAS = 'Falta aplicar la migración de ventas en la feria en Supabase.'
export const LARGO_MAX_NOMBRE_FERIA = 80

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

// '2026-10-10' -> 'sáb 10/10'. La fecha es un día (sin hora): se arma en hora
// local para que no se corra por la zona horaria.
export function fechaCortaFeria(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number)
  if (!y || !m || !d) return fecha
  const f = new Date(y, m - 1, d)
  return `${DIAS[f.getDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}

export function etiquetaFeria(f: Pick<Feria, 'nombre' | 'fecha'>): string {
  return `${f.nombre} · ${fechaCortaFeria(f.fecha)}`
}

// Hoy en 'YYYY-MM-DD' (hora del celular).
export function hoyISO(ahora = new Date()): string {
  const m = String(ahora.getMonth() + 1).padStart(2, '0')
  const d = String(ahora.getDate()).padStart(2, '0')
  return `${ahora.getFullYear()}-${m}-${d}`
}

// Nombre como lo guarda la base: sin espacios de más.
export function normalizarNombreFeria(nombre: string): string {
  return nombre.replace(/\s+/g, ' ').trim()
}

export function validarNuevaFeria(nombre: string, fecha: string): string | null {
  const n = normalizarNombreFeria(nombre)
  if (n === '') return 'Poné el nombre de la feria.'
  if (n.length > LARGO_MAX_NOMBRE_FERIA) return `El nombre puede tener hasta ${LARGO_MAX_NOMBRE_FERIA} letras.`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return 'Elegí la fecha de la feria.'
  return null
}

// Más recientes primero; a igual fecha, por nombre.
export function ordenarFerias(ferias: readonly Feria[]): Feria[] {
  return [...ferias].sort((a, b) =>
    a.fecha === b.fecha ? a.nombre.localeCompare(b.nombre, 'es') : a.fecha < b.fecha ? 1 : -1,
  )
}

function mensajeError(error: ErrorSupabase, fallback: string): string {
  if (esErrorDeRed(error)) return 'Sin conexión. Revisá internet y volvé a intentar.'
  if (esTablaInexistente(error) || esFuncionInexistente(error, 'registrar_venta_feria')) {
    return MENSAJE_FALTA_MIGRACION_FERIAS
  }
  return error.message || fallback
}

// ---- Base -------------------------------------------------------------------

export async function listarFerias(): Promise<Feria[]> {
  const { data, error } = await supabase
    .from('ferias')
    .select('id, nombre, fecha, activa')
    .eq('activa', true)
    .order('fecha', { ascending: false })
  if (error) throw new Error(mensajeError(error, 'No se pudieron cargar las ferias.'))
  return ordenarFerias((data ?? []) as Feria[])
}

export async function crearFeria(nombre: string, fecha: string): Promise<Feria> {
  const problema = validarNuevaFeria(nombre, fecha)
  if (problema) throw new Error(problema)
  const { data, error } = await supabase
    .from('ferias')
    .insert({ nombre: normalizarNombreFeria(nombre), fecha })
    .select('id, nombre, fecha, activa')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('Esa feria ya está cargada para ese día: elegila de la lista.')
    throw new Error(mensajeError(error, 'No se pudo crear la feria.'))
  }
  return data as Feria
}

export interface NuevaVentaFeria {
  feriaId: string
  medioPago: MedioPago
  items: readonly ItemNuevoPedido[]
  // Mismo valor en un reintento = misma venta (no descuenta el stock dos veces).
  idempotencyKey: string
}

// Devuelve el número de pedido. Los errores de la base (falta de stock…) ya
// vienen redactados para mostrarse tal cual.
export async function registrarVentaFeria({
  feriaId,
  medioPago,
  items,
  idempotencyKey,
}: NuevaVentaFeria): Promise<number> {
  const { data, error } = await supabase.rpc('registrar_venta_feria', {
    p_feria_id: feriaId,
    p_medio_pago: medioPago,
    // Ordenados por id, igual que crearPedido (evita bloqueos cruzados).
    p_items: [...items]
      .sort((a, b) => {
        const ka = `${a.id}:${a.talleId ?? ''}`
        const kb = `${b.id}:${b.talleId ?? ''}`
        return ka < kb ? -1 : ka > kb ? 1 : 0
      })
      .map((i) => ({ id: i.id, cantidad: i.cantidad, ...(i.talleId ? { talle_id: i.talleId } : {}) })),
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw new Error(mensajeError(error, 'No se pudo registrar la venta.'))
  return Number(data)
}

// ---- Preferencias del celular ---------------------------------------------------
// "Nuevo pedido" recuerda el último modo (manual o feria), la última feria y
// el último medio de pago: un día de feria se eligen una sola vez.

export type ModoNuevoPedido = 'manual' | 'feria'

export interface PreferenciasVenta {
  modo: ModoNuevoPedido
  feriaId: string | null
  medioPago: MedioPago
}

const CLAVE_PREFERENCIAS = 'pecora:nuevo-pedido'
const PREFERENCIAS_INICIALES: PreferenciasVenta = { modo: 'manual', feriaId: null, medioPago: 'efectivo' }

export function leerPreferenciasVenta(): PreferenciasVenta {
  try {
    const raw = localStorage.getItem(CLAVE_PREFERENCIAS)
    const p = raw ? (JSON.parse(raw) as Partial<PreferenciasVenta>) : {}
    return {
      modo: p.modo === 'feria' ? 'feria' : 'manual',
      feriaId: typeof p.feriaId === 'string' ? p.feriaId : null,
      medioPago: esMedioPago(p.medioPago) ? p.medioPago : 'efectivo',
    }
  } catch {
    return PREFERENCIAS_INICIALES
  }
}

export function guardarPreferenciasVenta(p: PreferenciasVenta): void {
  try {
    localStorage.setItem(CLAVE_PREFERENCIAS, JSON.stringify(p))
  } catch {
    // Sin almacenamiento (modo privado): no se recuerda, nada más.
  }
}
