import { supabase } from './supabaseClient'
import { money } from './format'
import type { EntregaPedido, OrigenPedido, Pedido } from '../types'

// ============================================================================
// Pedidos: cálculo de totales y alta vía la función crear_pedido.
// Único lugar donde se arma el payload del RPC: el checkout de la clienta y el
// alta manual del panel pasan por crearPedido().
// ============================================================================

const PREFIJO_LOG = '[pedidos]'

// Las 24 jurisdicciones de Argentina (23 provincias + CABA), para el selector
// de provincia del envío.
export const PROVINCIAS_AR = [
  'Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Ciudad Autónoma de Buenos Aires',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
] as const

// ---- Totales -----------------------------------------------------------------

// Lo mínimo de un ítem para calcular importes.
export interface ItemConImporte {
  precio: number
  cantidad: number
}

export interface TotalesPedido {
  subtotal: number
  descuento: number
  costoEnvio: number
  total: number
}

// Lo que hace falta de un pedido para sacar sus totales. Todo menos el
// subtotal es opcional: antes de la migración las filas no traen esas columnas.
export type MontosPedido = Pick<Pedido, 'subtotal'> &
  Partial<Pick<Pedido, 'descuento' | 'costo_envio' | 'total'>>

// Suma de precio × cantidad.
export function calcularSubtotal(items: readonly ItemConImporte[]): number {
  return items.reduce((n, i) => n + i.precio * i.cantidad, 0)
}

// Convierte un monto que puede venir como número, texto (numeric de Postgres)
// o faltar. Devuelve null si no es un número válido.
function montoOpcional(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// Totales de un pedido, tolerando filas/respuestas sin descuento, costo_envio o
// total (default 0; total = subtotal - descuento + costo_envio). Si la base ya
// trae el total (columna generada), se respeta ese valor.
export function totalesDe(pedido: MontosPedido): TotalesPedido {
  const subtotal = montoOpcional(pedido.subtotal) ?? 0
  const descuento = montoOpcional(pedido.descuento) ?? 0
  const costoEnvio = montoOpcional(pedido.costo_envio) ?? 0
  const total = montoOpcional(pedido.total) ?? subtotal - descuento + costoEnvio
  return { subtotal, descuento, costoEnvio, total }
}

export interface LineaDesglose {
  concepto: 'Subtotal' | 'Descuento' | 'Envío'
  // Negativo para el descuento.
  importe: number
}

// Líneas que van antes del total. Solo hay desglose si algo modifica el
// subtotal (descuento o envío con costo): si no, el total ya lo dice todo.
export function lineasDesglose(t: TotalesPedido): LineaDesglose[] {
  if (t.descuento <= 0 && t.costoEnvio <= 0) return []
  const lineas: LineaDesglose[] = [{ concepto: 'Subtotal', importe: t.subtotal }]
  if (t.descuento > 0) lineas.push({ concepto: 'Descuento', importe: -t.descuento })
  if (t.costoEnvio > 0) lineas.push({ concepto: 'Envío', importe: t.costoEnvio })
  return lineas
}

// Monto de una línea de desglose, con el signo menos tipográfico si resta.
export function montoLinea(importe: number): string {
  return importe < 0 ? `− ${money(-importe)}` : money(importe)
}

// Cómo se muestra el envío: su costo si ya se cargó; si no, "A coordinar"
// para envío a domicilio y "Sin costo" para retiro / a coordinar.
export function textoEnvio(t: TotalesPedido, entrega: EntregaPedido): string {
  if (t.costoEnvio > 0) return money(t.costoEnvio)
  return entrega === 'envio' ? 'A coordinar' : 'Sin costo'
}

// ---- Alta del pedido ------------------------------------------------------------

export interface ItemNuevoPedido {
  id: string
  nombre: string
  precio: number
  cantidad: number
}

export interface DatosNuevoPedido {
  nombre: string
  telefono: string
  email?: string | null
  entrega: EntregaPedido
  direccion?: string | null
  localidad?: string | null
  cp?: string | null
  provincia?: string | null
  notas?: string | null
}

export interface NuevoPedido {
  datos: DatosNuevoPedido
  items: readonly ItemNuevoPedido[]
  // Solo lo respeta la base si quien llama es admin (ver migración 0013).
  origen?: OrigenPedido
  // Mismo valor en un reintento = mismo pedido (la base no lo duplica ni
  // descuenta el stock dos veces).
  idempotencyKey?: string
}

// Texto opcional: recortado, y null si queda vacío.
function textoOpcional(valor: string | null | undefined): string | null {
  const limpio = valor?.trim() ?? ''
  return limpio === '' ? null : limpio
}

interface ErrorRpc {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

// ¿El error dice que la función (con esta firma) no existe? Es lo que responde
// PostgREST cuando el frontend llega a producción antes que la migración que
// suma p_provincia / p_idempotency_key: PGRST202 ("Could not find the function
// ... in the schema cache") o, desde Postgres, 42883 (undefined_function).
export function esFirmaInexistente(error: ErrorRpc): boolean {
  if (error.code === 'PGRST202' || error.code === '42883') return true
  const texto = [error.message, error.details, error.hint].filter(Boolean).join(' ')
  return /crear_pedido/i.test(texto) && /could not find|does not exist|schema cache/i.test(texto)
}

// Fallo de conexión (sin respuesta del servidor): supabase-js lo devuelve como
// error sin código y con el mensaje del fetch.
function esErrorDeRed(error: ErrorRpc): boolean {
  return !error.code && /failed to fetch|networkerror|network request failed|load failed/i.test(error.message ?? '')
}

// El RPC devuelve el número de pedido (bigint): puede llegar como número o texto.
function numeroDePedido(data: unknown): number | null {
  const n = typeof data === 'string' ? Number(data) : data
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null
}

// Registra el pedido con la función crear_pedido (SECURITY DEFINER) y devuelve
// su número. La base recalcula precios y subtotal con los valores vigentes y
// descuenta el stock; p_subtotal se sigue mandando por compatibilidad.
//
// Orden de despliegue: si la base todavía no tiene la firma nueva (sin
// p_provincia / p_idempotency_key), se reintenta UNA vez con la firma anterior
// de 11 parámetros. En ese caso se pierde la provincia y la protección contra
// duplicados, igual que antes de la migración.
//
// Los errores de la base (falta de stock, carrito vacío…) ya vienen redactados
// para mostrarse tal cual.
export async function crearPedido({
  datos,
  items,
  origen = 'checkout',
  idempotencyKey,
}: NuevoPedido): Promise<number> {
  const envio = datos.entrega === 'envio'
  const firmaAnterior = {
    p_nombre: datos.nombre.trim(),
    p_telefono: datos.telefono.trim(),
    p_email: textoOpcional(datos.email),
    p_entrega: datos.entrega,
    p_direccion: envio ? textoOpcional(datos.direccion) : null,
    p_localidad: envio ? textoOpcional(datos.localidad) : null,
    p_cp: envio ? textoOpcional(datos.cp) : null,
    p_notas: textoOpcional(datos.notas),
    p_items: items.map((i) => ({
      id: i.id,
      nombre: i.nombre,
      precio: i.precio,
      cantidad: i.cantidad,
    })),
    p_subtotal: calcularSubtotal(items),
    p_origen: origen,
  }
  const firmaNueva = {
    ...firmaAnterior,
    p_provincia: envio ? textoOpcional(datos.provincia) : null,
    p_idempotency_key: idempotencyKey ?? null,
  }

  let { data, error } = await supabase.rpc('crear_pedido', firmaNueva)
  if (error && esFirmaInexistente(error)) {
    console.warn(
      `${PREFIJO_LOG} crear_pedido todavía no acepta p_provincia / p_idempotency_key ` +
        '(falta aplicar la migración): se reintenta con la firma anterior.',
      error.message,
    )
    ;({ data, error } = await supabase.rpc('crear_pedido', firmaAnterior))
  }

  if (error) {
    if (esErrorDeRed(error)) {
      throw new Error(
        'No pudimos conectarnos para registrar el pedido. Revisá tu conexión y volvé a intentar.',
      )
    }
    throw new Error(error.message || 'No pudimos registrar el pedido. Probá de nuevo en un momento.')
  }

  const numero = numeroDePedido(data)
  if (numero === null) {
    throw new Error(
      'No pudimos confirmar el número del pedido. Revisá "Mis pedidos" antes de volver a intentar.',
    )
  }
  return numero
}

// Clave de idempotencia (UUID v4). crypto.randomUUID solo existe en contextos
// seguros (https / localhost): si falta (ej. probando desde el celular por la
// IP de la red local), se arma con crypto.getRandomValues.
export function nuevaClaveIdempotencia(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  c.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // versión 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variante RFC 4122
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
