import { supabase } from './supabaseClient'
import { aNumero } from './cupones'
import type { ProductoConCategoria } from '../types'

// ============================================================================
// "Lo más vendido" del muestrario (RPC pública mas_vendidos).
//
// La RPC solo devuelve ids y unidades; los datos del producto (precio, stock,
// imagen) salen de la lista de useProducts, que ya está en memoria y se
// mantiene al día por Realtime. El ranking se guarda en sessionStorage por
// 10 minutos: no cambia tanto y así no se pide en cada vuelta al muestrario.
// ============================================================================

export interface MasVendido {
  producto_id: string
  unidades: number
}

export const LIMITE_MAS_VENDIDOS = 8
export const DIAS_MAS_VENDIDOS = 90
// Con menos de esto la sección no se muestra (una fila de 1–2 cards se ve pobre).
export const MINIMO_MAS_VENDIDOS = 3
export const TTL_MAS_VENDIDOS_MS = 10 * 60 * 1000
export const CLAVE_CACHE_MAS_VENDIDOS = 'pecora:mas-vendidos:v1'

// Acepta lo que devuelva la RPC y se queda solo con filas válidas, sin repetir.
export function normalizarMasVendidos(data: unknown): MasVendido[] {
  if (!Array.isArray(data)) return []
  const vistos = new Set<string>()
  const filas: MasVendido[] = []
  for (const fila of data) {
    if (!fila || typeof fila !== 'object') continue
    const { producto_id, unidades } = fila as Record<string, unknown>
    if (typeof producto_id !== 'string' || !producto_id || vistos.has(producto_id)) continue
    vistos.add(producto_id)
    filas.push({ producto_id, unidades: aNumero(unidades) })
  }
  return filas
}

// Cruza el ranking con los productos cargados: descarta los que ya no existen
// y manda al final los que están sin stock (siguen siendo "lo más vendido",
// pero primero lo que se puede comprar). Respeta el orden del ranking.
export function resolverMasVendidos(
  ranking: MasVendido[],
  productos: ProductoConCategoria[],
  limite = LIMITE_MAS_VENDIDOS,
): ProductoConCategoria[] {
  const porId = new Map(productos.map((p) => [p.id, p]))
  const conStock: ProductoConCategoria[] = []
  const sinStock: ProductoConCategoria[] = []
  for (const { producto_id } of ranking) {
    const p = porId.get(producto_id)
    if (!p) continue
    ;(p.stock > 0 ? conStock : sinStock).push(p)
  }
  return [...conStock, ...sinStock].slice(0, Math.max(0, limite))
}

// ---- Caché de sesión -------------------------------------------------------

// Lo mínimo de Storage que se usa (inyectable en tests).
export interface AlmacenSimple {
  getItem(clave: string): string | null
  setItem(clave: string, valor: string): void
}

interface EntradaCache {
  t: number
  filas: MasVendido[]
}

export function leerCacheMasVendidos(
  almacen: AlmacenSimple | null,
  ahora: number,
  ttl = TTL_MAS_VENDIDOS_MS,
): MasVendido[] | null {
  if (!almacen) return null
  try {
    const crudo = almacen.getItem(CLAVE_CACHE_MAS_VENDIDOS)
    if (!crudo) return null
    const entrada = JSON.parse(crudo) as Partial<EntradaCache>
    if (typeof entrada?.t !== 'number') return null
    const edad = ahora - entrada.t
    if (edad < 0 || edad > ttl) return null
    return normalizarMasVendidos(entrada.filas)
  } catch {
    return null
  }
}

export function guardarCacheMasVendidos(
  almacen: AlmacenSimple | null,
  filas: MasVendido[],
  ahora: number,
): void {
  if (!almacen) return
  try {
    const entrada: EntradaCache = { t: ahora, filas }
    almacen.setItem(CLAVE_CACHE_MAS_VENDIDOS, JSON.stringify(entrada))
  } catch {
    // Storage lleno, bloqueado o en modo privado: se sigue sin caché.
  }
}

function almacenDeSesion(): AlmacenSimple | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

// ---- Carga ----------------------------------------------------------------

export type ResultadoMasVendidos =
  | { ok: true; filas: MasVendido[] }
  | { ok: false }

// Un solo pedido en vuelo por pestaña (el muestrario se puede montar varias
// veces seguidas al navegar).
let enVuelo: Promise<ResultadoMasVendidos> | null = null

export function cargarMasVendidos(
  almacen: AlmacenSimple | null = almacenDeSesion(),
): Promise<ResultadoMasVendidos> {
  const enCache = leerCacheMasVendidos(almacen, Date.now())
  if (enCache) return Promise.resolve({ ok: true, filas: enCache })
  if (enVuelo) return enVuelo

  const pedido = (async (): Promise<ResultadoMasVendidos> => {
    try {
      const { data, error } = await supabase.rpc('mas_vendidos', {
        p_limite: LIMITE_MAS_VENDIDOS,
        p_dias: DIAS_MAS_VENDIDOS,
      })
      if (error) {
        // Sin la migración (o con un error cualquiera) la sección no aparece.
        console.warn('[mas_vendidos] no disponible:', error.message)
        return { ok: false }
      }
      const filas = normalizarMasVendidos(data)
      guardarCacheMasVendidos(almacen, filas, Date.now())
      return { ok: true, filas }
    } catch (e) {
      console.warn('[mas_vendidos] no disponible:', e)
      return { ok: false }
    }
  })()
  enVuelo = pedido
  void pedido.then(() => {
    if (enVuelo === pedido) enVuelo = null
  })
  return pedido
}
