import { supabase } from './supabaseClient'
import { aNumero, esErrorDeRed, esFuncionInexistente, type ErrorSupabase } from './cupones'
import { fechaISO, mesesEntre, type Rango } from './estadisticas'
import { CATEGORIAS_GASTO, MENSAJE_FALTA_MIGRACION_GASTOS, esCategoriaGasto, type CategoriaGasto } from './gastos'

// ============================================================================
// Rentabilidad (RPC rentabilidad(p_desde, p_hasta), solo admin): ingresos vs.
// gastos vs. beneficio por mes, estimación por producto y proyección simple.
// Todo lo que no es UI vive acá; las estimaciones son funciones puras.
// ============================================================================

export interface RentabilidadMes {
  mes: string // 'YYYY-MM'
  ingresos: number
  gastos: number
  beneficio: number
  margen: number | null // % con 1 decimal; null sin ingresos
}

export interface RentabilidadProducto {
  producto_id: string
  nombre: string
  unidades_vendidas: number
  ingresos: number
  // null = sin compras con cantidad para este producto (no se puede estimar).
  costo_unitario_estimado: number | null
  costo_estimado: number | null
  beneficio_estimado: number | null
  margen: number | null
  // Gastos cargados para este producto dentro del rango.
  gastos_periodo: number
}

export interface TotalesRentabilidad {
  ingresos: number
  gastos: number
  beneficio: number
  margen: number | null
  pedidos: number
}

export interface Rentabilidad {
  por_mes: RentabilidadMes[]
  totales: TotalesRentabilidad
  productos: RentabilidadProducto[]
  gastos_por_categoria: { categoria: CategoriaGasto; total: number }[]
  gastos_generales: number
}

export const MENSAJE_FALTA_MIGRACION_RENTABILIDAD = MENSAJE_FALTA_MIGRACION_GASTOS

// ---- Cálculos básicos ---------------------------------------------------------

// Margen en % (beneficio / ingresos) con 1 decimal; null si no hubo ingresos.
export function margen(beneficio: number, ingresos: number): number | null {
  if (!(ingresos > 0) || !Number.isFinite(beneficio)) return null
  return Math.round((beneficio / ingresos) * 1000) / 10
}

// ---- Normalización --------------------------------------------------------------

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function numeroONull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function mesDe(v: Record<string, unknown>): RentabilidadMes {
  const ingresos = aNumero(v.ingresos)
  const gastos = aNumero(v.gastos)
  const beneficio = v.beneficio != null ? aNumero(v.beneficio) : ingresos - gastos
  return {
    mes: (v.mes as string).slice(0, 7),
    ingresos,
    gastos,
    beneficio,
    margen: v.margen !== undefined ? numeroONull(v.margen) : margen(beneficio, ingresos),
  }
}

// Acepta la respuesta tal cual venga (jsonb, montos como texto, campos que
// falten) y devuelve siempre la forma completa.
export function normalizarRentabilidad(data: unknown): Rentabilidad {
  const d = objeto(Array.isArray(data) ? data[0] : data)

  const porMes = (Array.isArray(d.por_mes) ? d.por_mes : [])
    .map(objeto)
    .filter((v) => typeof v.mes === 'string' && /^\d{4}-\d{2}/.test(v.mes))
    .map(mesDe)
    .sort((a, b) => a.mes.localeCompare(b.mes))

  const productos = (Array.isArray(d.productos) ? d.productos : [])
    .map(objeto)
    .filter((p) => typeof p.producto_id === 'string')
    .map((p) => {
      const ingresos = aNumero(p.ingresos)
      const costo = numeroONull(p.costo_estimado)
      const beneficio = numeroONull(p.beneficio_estimado) ?? (costo !== null ? ingresos - costo : null)
      return {
        producto_id: p.producto_id as string,
        nombre: typeof p.nombre === 'string' && p.nombre.trim() ? p.nombre : 'Producto eliminado',
        unidades_vendidas: aNumero(p.unidades_vendidas),
        ingresos,
        costo_unitario_estimado: numeroONull(p.costo_unitario_estimado),
        costo_estimado: costo,
        beneficio_estimado: beneficio,
        margen:
          p.margen !== undefined ? numeroONull(p.margen) : beneficio !== null ? margen(beneficio, ingresos) : null,
        gastos_periodo: aNumero(p.gastos_periodo),
      }
    })

  // Siempre las 4 categorías, en el orden de CATEGORIAS_GASTO.
  const porCategoria = new Map<CategoriaGasto, number>()
  for (const c of Array.isArray(d.gastos_por_categoria) ? d.gastos_por_categoria : []) {
    const o = objeto(c)
    if (esCategoriaGasto(o.categoria)) porCategoria.set(o.categoria, aNumero(o.total))
  }

  const t = objeto(d.totales)
  // Sin totales en la respuesta, se suman los meses.
  const ingresos = d.totales ? aNumero(t.ingresos) : porMes.reduce((s, m) => s + m.ingresos, 0)
  const gastos = d.totales ? aNumero(t.gastos) : porMes.reduce((s, m) => s + m.gastos, 0)
  const beneficio = t.beneficio != null ? aNumero(t.beneficio) : ingresos - gastos

  return {
    por_mes: porMes,
    totales: {
      ingresos,
      gastos,
      beneficio,
      margen: t.margen !== undefined ? numeroONull(t.margen) : margen(beneficio, ingresos),
      pedidos: aNumero(t.pedidos),
    },
    productos,
    gastos_por_categoria: CATEGORIAS_GASTO.map((c) => ({
      categoria: c.valor,
      total: porCategoria.get(c.valor) ?? 0,
    })),
    gastos_generales: aNumero(d.gastos_generales),
  }
}

// Completa con ceros los meses del rango que falten (la RPC ya los devuelve
// todos; esto es por si acaso) para que el gráfico no "salte" meses.
export function completarMesesRentabilidad(meses: RentabilidadMes[], rango: Rango): RentabilidadMes[] {
  const porMes = new Map(meses.map((m) => [m.mes, m]))
  const todos = mesesEntre(rango.desde, rango.hasta)
  if (todos.length === 0) return meses
  const fuera = meses.filter((m) => !todos.includes(m.mes))
  return [
    ...todos.map((mes) => porMes.get(mes) ?? { mes, ingresos: 0, gastos: 0, beneficio: 0, margen: null }),
    ...fuera,
  ].sort((a, b) => a.mes.localeCompare(b.mes))
}

export function sinMovimiento(r: Rentabilidad): boolean {
  return r.totales.ingresos === 0 && r.totales.gastos === 0 && r.productos.length === 0
}

// ---- Estimaciones (simples y explicables) ---------------------------------------

export function tieneCosto(p: RentabilidadProducto): boolean {
  return p.costo_unitario_estimado !== null && p.beneficio_estimado !== null
}

// El más vendido por unidades (desempate: ingresos). null si no hubo ventas.
export function masVendido(productos: RentabilidadProducto[]): RentabilidadProducto | null {
  let mejor: RentabilidadProducto | null = null
  for (const p of productos) {
    if (!(p.unidades_vendidas > 0)) continue
    if (
      !mejor ||
      p.unidades_vendidas > mejor.unidades_vendidas ||
      (p.unidades_vendidas === mejor.unidades_vendidas && p.ingresos > mejor.ingresos)
    ) {
      mejor = p
    }
  }
  return mejor
}

// Vendidos en el período y con costo estimado.
function vendidosConCosto(productos: RentabilidadProducto[]): RentabilidadProducto[] {
  return productos.filter((p) => p.unidades_vendidas > 0 && tieneCosto(p))
}

// El que más beneficio estimado dejó (en pesos). Solo productos con costo.
export function masRentable(productos: RentabilidadProducto[]): RentabilidadProducto | null {
  let mejor: RentabilidadProducto | null = null
  for (const p of vendidosConCosto(productos)) {
    if (!mejor || (p.beneficio_estimado as number) > (mejor.beneficio_estimado as number)) mejor = p
  }
  return mejor
}

// El de mejor margen (%): el que más deja por cada peso vendido.
export function mejorMargen(productos: RentabilidadProducto[]): RentabilidadProducto | null {
  let mejor: RentabilidadProducto | null = null
  for (const p of vendidosConCosto(productos)) {
    if (p.margen === null) continue
    if (!mejor || p.margen > (mejor.margen as number)) mejor = p
  }
  return mejor
}

// Vendidos en el período pero sin compras con cantidad cargadas: no se puede
// estimar su costo. Se muestran aparte para que la admin sepa qué completar.
export function sinDatosDeCosto(productos: RentabilidadProducto[]): RentabilidadProducto[] {
  return productos.filter((p) => p.unidades_vendidas > 0 && !tieneCosto(p))
}

// Los productos ordenados por beneficio estimado (los sin costo al final,
// por ingresos).
export function ordenarPorBeneficio(productos: RentabilidadProducto[]): RentabilidadProducto[] {
  return [...productos].sort((a, b) => {
    const ba = a.beneficio_estimado
    const bb = b.beneficio_estimado
    if (ba !== null && bb !== null && ba !== bb) return bb - ba
    if (ba === null && bb !== null) return 1
    if (ba !== null && bb === null) return -1
    return b.ingresos - a.ingresos || a.nombre.localeCompare(b.nombre)
  })
}

// ---- Proyección del mes que viene -----------------------------------------------

export const MESES_PROYECCION = 3

const dos = (n: number) => String(n).padStart(2, '0')

// Los `n` meses completos anteriores al mes de `hoy` (el actual no cuenta
// porque todavía no terminó). Ej.: hoy 28/09 → 01/06 a 31/08.
export function rangoMesesCompletos(hoy: Date, n = MESES_PROYECCION): Rango {
  const y = hoy.getFullYear()
  const m = hoy.getMonth()
  return { desde: fechaISO(new Date(y, m - n, 1)), hasta: fechaISO(new Date(y, m, 0)) }
}

export function mesSiguiente(hoy: Date): string {
  const d = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1)
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}`
}

export interface Proyeccion {
  mes: string // 'YYYY-MM' del mes que se estima
  ingresos: number
  gastos: number
  beneficio: number
  // Cuántos meses se promediaron (los que tuvieron algún movimiento).
  mesesBase: number
}

// Estimación para el mes que viene: promedio de los últimos meses completos
// (hasta 3) que tuvieron ventas o gastos. Los meses sin ningún movimiento no
// cuentan, para no bajar el promedio si el negocio arrancó hace poco.
// null si no hay ningún mes con datos.
export function proyectarProximoMes(meses: RentabilidadMes[], hoy: Date): Proyeccion | null {
  const actual = `${hoy.getFullYear()}-${dos(hoy.getMonth() + 1)}`
  const base = meses
    .filter((m) => m.mes < actual && (m.ingresos > 0 || m.gastos > 0))
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .slice(-MESES_PROYECCION)
  if (base.length === 0) return null
  const prom = (f: (m: RentabilidadMes) => number) =>
    Math.round(base.reduce((s, m) => s + f(m), 0) / base.length)
  const ingresos = prom((m) => m.ingresos)
  const gastos = prom((m) => m.gastos)
  return { mes: mesSiguiente(hoy), ingresos, gastos, beneficio: ingresos - gastos, mesesBase: base.length }
}

// ---- Carga ------------------------------------------------------------------------

export type ResultadoRentabilidad =
  | { ok: true; datos: Rentabilidad; proyeccion: Proyeccion | null }
  | { ok: false; faltaMigracion: boolean; mensaje: string }

export function describirErrorRentabilidad(error: ErrorSupabase): { faltaMigracion: boolean; mensaje: string } {
  if (esFuncionInexistente(error, 'rentabilidad')) {
    return { faltaMigracion: true, mensaje: MENSAJE_FALTA_MIGRACION_RENTABILIDAD }
  }
  if (esErrorDeRed(error)) {
    return { faltaMigracion: false, mensaje: 'No hay conexión. Revisá internet y volvé a intentar.' }
  }
  if (error.code === '42501' || /no autorizad|not authorized|permission denied/i.test(error.message ?? '')) {
    return { faltaMigracion: false, mensaje: 'Tu usuario no tiene permiso para ver la rentabilidad.' }
  }
  if (error.code === '22023' && error.message) {
    return { faltaMigracion: false, mensaje: error.message }
  }
  return { faltaMigracion: false, mensaje: 'No se pudo calcular la rentabilidad.' }
}

async function llamar(rango: Rango) {
  return supabase.rpc('rentabilidad', { p_desde: rango.desde, p_hasta: rango.hasta })
}

// Trae la rentabilidad del rango y, en paralelo, la de los últimos meses
// completos para la proyección. Si solo falla la segunda, se muestra todo
// menos la proyección.
export async function cargarRentabilidad(rango: Rango, hoy: Date = new Date()): Promise<ResultadoRentabilidad> {
  try {
    const [principal, base] = await Promise.all([
      llamar(rango),
      llamar(rangoMesesCompletos(hoy)).catch(() => ({ data: null, error: { message: 'sin datos' } })),
    ])
    if (principal.error) {
      console.error('[rentabilidad]', principal.error)
      return { ok: false, ...describirErrorRentabilidad(principal.error) }
    }
    const proyeccion = base.error ? null : proyectarProximoMes(normalizarRentabilidad(base.data).por_mes, hoy)
    return { ok: true, datos: normalizarRentabilidad(principal.data), proyeccion }
  } catch (e) {
    console.error('[rentabilidad]', e)
    return {
      ok: false,
      ...describirErrorRentabilidad({ message: e instanceof Error ? e.message : String(e) }),
    }
  }
}
