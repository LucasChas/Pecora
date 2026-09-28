import { supabase } from './supabaseClient'
import { aNumero, esErrorDeRed, esFuncionInexistente, type ErrorSupabase } from './cupones'

// ============================================================================
// Estadísticas del panel (RPC estadisticas(p_desde, p_hasta), solo admin).
// Acá vive todo lo que no es UI: períodos, normalización de la respuesta,
// relleno de meses sin ventas y la llamada a la RPC.
// ============================================================================

export interface VentaMes {
  mes: string // 'YYYY-MM'
  pedidos: number
  total: number
}

export interface MasVendidoStat {
  producto_id: string
  nombre: string
  unidades: number
  importe: number
}

export interface TotalesOrigen {
  pedidos: number
  total: number
}

export interface Estadisticas {
  ventas_por_mes: VentaMes[]
  total_periodo: number
  pedidos_periodo: number
  ticket_promedio: number
  mas_vendidos: MasVendidoStat[]
  clientas_nuevas: number
  clientas_con_compra: number
  por_origen: { checkout: TotalesOrigen; admin: TotalesOrigen }
}

export type Periodo = 'este-mes' | 'mes-pasado' | 'ultimos-3' | 'este-anio' | 'personalizado'

export const PERIODOS: { valor: Periodo; etiqueta: string }[] = [
  { valor: 'este-mes', etiqueta: 'Este mes' },
  { valor: 'mes-pasado', etiqueta: 'Mes pasado' },
  { valor: 'ultimos-3', etiqueta: 'Últimos 3 meses' },
  { valor: 'este-anio', etiqueta: 'Este año' },
  { valor: 'personalizado', etiqueta: 'Personalizado' },
]

export interface Rango {
  desde: string // 'YYYY-MM-DD'
  hasta: string // 'YYYY-MM-DD' (inclusive)
}

export const MENSAJE_FALTA_MIGRACION_ESTADISTICAS =
  'Falta aplicar la migración de estadísticas en Supabase.'

// ---- Fechas (siempre en hora local, sin pasar por UTC) ---------------------

const dos = (n: number) => String(n).padStart(2, '0')

export function fechaISO(d: Date): string {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`
}

// Rango de un período predefinido, relativo a `hoy`. "Hasta" es hoy (o el
// último día del mes pasado): no tiene sentido pedir días que no pasaron.
export function rangoDePeriodo(periodo: Exclude<Periodo, 'personalizado'>, hoy: Date): Rango {
  const y = hoy.getFullYear()
  const m = hoy.getMonth()
  switch (periodo) {
    case 'este-mes':
      return { desde: fechaISO(new Date(y, m, 1)), hasta: fechaISO(hoy) }
    case 'mes-pasado':
      return { desde: fechaISO(new Date(y, m - 1, 1)), hasta: fechaISO(new Date(y, m, 0)) }
    case 'ultimos-3':
      // El mes actual y los dos anteriores, completos.
      return { desde: fechaISO(new Date(y, m - 2, 1)), hasta: fechaISO(hoy) }
    case 'este-anio':
      return { desde: fechaISO(new Date(y, 0, 1)), hasta: fechaISO(hoy) }
  }
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

function esFechaValida(s: string): boolean {
  if (!RE_FECHA.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const f = new Date(y, m - 1, d)
  return f.getFullYear() === y && f.getMonth() === m - 1 && f.getDate() === d
}

// Mensaje de error para un rango personalizado, o null si es válido.
export function validarRango(desde: string, hasta: string): string | null {
  if (!desde || !hasta) return 'Elegí las dos fechas.'
  if (!esFechaValida(desde) || !esFechaValida(hasta)) return 'Alguna de las fechas no es válida.'
  if (desde > hasta) return 'La fecha "desde" tiene que ser anterior a "hasta".'
  return null
}

// Todos los meses 'YYYY-MM' entre dos fechas (inclusive), en orden.
export function mesesEntre(desde: string, hasta: string): string[] {
  let y = Number(desde.slice(0, 4))
  let m = Number(desde.slice(5, 7))
  const yFin = Number(hasta.slice(0, 4))
  const mFin = Number(hasta.slice(5, 7))
  const meses: string[] = []
  // Tope de seguridad: 20 años de meses.
  while ((y < yFin || (y === yFin && m <= mFin)) && meses.length < 240) {
    meses.push(`${y}-${dos(m)}`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return meses
}

// Completa con ceros los meses del rango que no tuvieron ventas (la RPC solo
// devuelve meses con pedidos) para que el gráfico no "salte" meses.
export function completarMeses(ventas: VentaMes[], rango: Rango): VentaMes[] {
  const porMes = new Map(ventas.map((v) => [v.mes, v]))
  const meses = mesesEntre(rango.desde, rango.hasta)
  if (meses.length === 0) return ventas
  // Si la RPC devolvió meses fuera del rango (no debería), no se pierden.
  const fuera = ventas.filter((v) => !meses.includes(v.mes))
  return [...meses.map((mes) => porMes.get(mes) ?? { mes, pedidos: 0, total: 0 }), ...fuera].sort(
    (a, b) => a.mes.localeCompare(b.mes),
  )
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MESES_LARGOS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

// 'YYYY-MM' → 'sep 26' (corto, para el eje) o 'septiembre 2026' (largo).
export function etiquetaMes(mes: string, largo = false): string {
  const y = Number(mes.slice(0, 4))
  const m = Number(mes.slice(5, 7))
  if (!y || m < 1 || m > 12) return mes
  return largo ? `${MESES_LARGOS[m - 1]} ${y}` : `${MESES_CORTOS[m - 1]} ${String(y).slice(2)}`
}

// Porcentaje entero (0–100) de `parte` sobre `total`, sin dividir por cero.
export function porcentaje(parte: number, total: number): number {
  if (!(total > 0) || !(parte > 0)) return 0
  return Math.min(100, Math.round((parte / total) * 100))
}

// ---- Normalización --------------------------------------------------------

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function origen(v: unknown): TotalesOrigen {
  const o = objeto(v)
  return { pedidos: aNumero(o.pedidos), total: aNumero(o.total) }
}

// Acepta la respuesta tal cual venga (jsonb, montos como texto, campos que
// falten) y devuelve siempre la forma completa.
export function normalizarEstadisticas(data: unknown): Estadisticas {
  const d = objeto(Array.isArray(data) ? data[0] : data)
  const ventas = (Array.isArray(d.ventas_por_mes) ? d.ventas_por_mes : [])
    .map(objeto)
    .filter((v) => typeof v.mes === 'string' && /^\d{4}-\d{2}/.test(v.mes))
    .map((v) => ({
      mes: (v.mes as string).slice(0, 7),
      pedidos: aNumero(v.pedidos),
      total: aNumero(v.total),
    }))
    .sort((a, b) => a.mes.localeCompare(b.mes))

  const masVendidos = (Array.isArray(d.mas_vendidos) ? d.mas_vendidos : [])
    .map(objeto)
    .filter((v) => typeof v.producto_id === 'string' || typeof v.nombre === 'string')
    .map((v, i) => ({
      producto_id: typeof v.producto_id === 'string' ? v.producto_id : `sin-id-${i}`,
      nombre: typeof v.nombre === 'string' && v.nombre.trim() ? v.nombre : 'Producto eliminado',
      unidades: aNumero(v.unidades),
      importe: aNumero(v.importe),
    }))

  const pedidos = aNumero(d.pedidos_periodo)
  const total = aNumero(d.total_periodo)
  const po = objeto(d.por_origen)

  return {
    ventas_por_mes: ventas,
    total_periodo: total,
    pedidos_periodo: pedidos,
    // Si la RPC no lo trae, se calcula.
    ticket_promedio:
      d.ticket_promedio != null ? aNumero(d.ticket_promedio) : pedidos > 0 ? total / pedidos : 0,
    mas_vendidos: masVendidos,
    clientas_nuevas: aNumero(d.clientas_nuevas),
    clientas_con_compra: aNumero(d.clientas_con_compra),
    por_origen: { checkout: origen(po.checkout), admin: origen(po.admin) },
  }
}

export function sinDatos(e: Estadisticas): boolean {
  return e.pedidos_periodo === 0 && e.total_periodo === 0 && e.mas_vendidos.length === 0
}

// ---- Carga ----------------------------------------------------------------

export type ResultadoEstadisticas =
  | { ok: true; datos: Estadisticas }
  | { ok: false; faltaMigracion: boolean; mensaje: string }

export function describirErrorEstadisticas(error: ErrorSupabase): {
  faltaMigracion: boolean
  mensaje: string
} {
  if (esFuncionInexistente(error, 'estadisticas')) {
    return { faltaMigracion: true, mensaje: MENSAJE_FALTA_MIGRACION_ESTADISTICAS }
  }
  if (esErrorDeRed(error)) {
    return { faltaMigracion: false, mensaje: 'No hay conexión. Revisá internet y volvé a intentar.' }
  }
  // 42501 (insufficient_privilege) / "no autorizado": la sesión no es admin.
  if (error.code === '42501' || /no autorizad|not authorized|permission denied/i.test(error.message ?? '')) {
    return { faltaMigracion: false, mensaje: 'Tu usuario no tiene permiso para ver las estadísticas.' }
  }
  // 22023: la RPC validó el rango y explica qué está mal.
  if (error.code === '22023' && error.message) {
    return { faltaMigracion: false, mensaje: error.message }
  }
  return { faltaMigracion: false, mensaje: 'No se pudieron cargar las estadísticas.' }
}

export async function cargarEstadisticas(rango: Rango): Promise<ResultadoEstadisticas> {
  try {
    const { data, error } = await supabase.rpc('estadisticas', {
      p_desde: rango.desde,
      p_hasta: rango.hasta,
    })
    if (error) {
      console.error('[estadisticas]', error)
      return { ok: false, ...describirErrorEstadisticas(error) }
    }
    return { ok: true, datos: normalizarEstadisticas(data) }
  } catch (e) {
    console.error('[estadisticas]', e)
    return {
      ok: false,
      ...describirErrorEstadisticas({ message: e instanceof Error ? e.message : String(e) }),
    }
  }
}
