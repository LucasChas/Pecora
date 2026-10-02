import { supabase } from './supabaseClient'
import { money } from './format'
import { ErrorCotizacionVencida, esCotizacionVencida, etiquetaEnvioPedido } from './transportistas'
import type { EntregaPedido, EstadoPedido, OrigenPedido, Pedido } from '../types'

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
  // Texto a mostrar: el concepto con el cupón o la zona entre paréntesis
  // (ej. "Descuento (VERANO10)", "Envío (AMBA)").
  etiqueta: string
  // Negativo para el descuento.
  importe: number
  // Texto en lugar del monto (ej. "Gratis" para un envío sin costo).
  texto?: string
}

// Cupón y zona de envío que se aplicaron al pedido (columnas cupon_codigo y
// zona_nombre). Opcionales: antes de la migración no existen.
// "zona" es el nombre con el que se muestra el envío: la zona o, si se envía
// con transportista, "Andreani a sucursal" / "Correo Argentino a domicilio".
export interface DetallePedido {
  cupon?: string | null
  zona?: string | null
}

// Detalle de cupón / envío de una fila de pedidos (tolera columnas ausentes).
// El transportista, si lo hay, gana sobre la zona.
export function detalleDe(
  pedido: Partial<
    Pick<Pedido, 'cupon_codigo' | 'zona_nombre' | 'transportista' | 'servicio_envio' | 'sucursal_envio'>
  >,
): DetallePedido {
  return {
    cupon: textoOpcional(pedido.cupon_codigo),
    zona: etiquetaEnvioPedido(pedido) ?? textoOpcional(pedido.zona_nombre),
  }
}

// Líneas que van antes del total. Solo hay desglose si algo modifica el
// subtotal (descuento o envío con costo) o si el envío quedó gratis por zona o
// cupón: si no, el total ya lo dice todo.
export function lineasDesglose(t: TotalesPedido, detalle: DetallePedido = {}): LineaDesglose[] {
  const cupon = textoOpcional(detalle.cupon)
  const zona = textoOpcional(detalle.zona)
  // Cupón de envío gratis: no genera descuento, se nombra en la línea de envío.
  const cuponEnEnvio = cupon !== null && t.descuento <= 0
  const envioGratis = t.costoEnvio <= 0 && (zona !== null || cuponEnEnvio)
  if (t.descuento <= 0 && t.costoEnvio <= 0 && !envioGratis) return []

  const lineas: LineaDesglose[] = [{ concepto: 'Subtotal', etiqueta: 'Subtotal', importe: t.subtotal }]
  if (t.descuento > 0) {
    lineas.push({
      concepto: 'Descuento',
      etiqueta: cupon ? `Descuento (${cupon})` : 'Descuento',
      importe: -t.descuento,
    })
  }
  const partesEnvio = [zona, cuponEnEnvio ? `cupón ${cupon}` : null].filter(Boolean)
  const etiquetaEnvio = partesEnvio.length > 0 ? `Envío (${partesEnvio.join(' · ')})` : 'Envío'
  if (t.costoEnvio > 0) {
    lineas.push({ concepto: 'Envío', etiqueta: etiquetaEnvio, importe: t.costoEnvio })
  } else if (envioGratis) {
    lineas.push({ concepto: 'Envío', etiqueta: etiquetaEnvio, importe: 0, texto: 'Gratis' })
  }
  return lineas
}

// Monto de una línea de desglose, con el signo menos tipográfico si resta.
export function montoLinea(importe: number): string {
  return importe < 0 ? `− ${money(-importe)}` : money(importe)
}

// Cómo se muestra el envío: su costo si ya se cargó; "Gratis" si es a domicilio
// y la base le asignó una zona (o un cupón de envío gratis) sin costo; si no,
// "A coordinar" para envío a domicilio y "Sin costo" para retiro / a coordinar.
export function textoEnvio(
  t: TotalesPedido,
  entrega: EntregaPedido,
  detalle: DetallePedido = {},
): string {
  if (t.costoEnvio > 0) return money(t.costoEnvio)
  if (entrega !== 'envio') return 'Sin costo'
  const cuponEnEnvio = Boolean(textoOpcional(detalle.cupon)) && t.descuento <= 0
  return textoOpcional(detalle.zona) || cuponEnEnvio ? 'Gratis' : 'A coordinar'
}

// ---- Alta del pedido ------------------------------------------------------------

export interface ItemNuevoPedido {
  id: string
  nombre: string
  precio: number
  cantidad: number
  // Talle elegido, si el producto se vende por talle.
  talleId?: string | null
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
  // Código de cupón. La base lo valida y calcula el descuento; si no es
  // válido, rechaza el pedido con un mensaje ya redactado.
  cupon?: string | null
  // Id de la opción de transportista elegida (Edge Function cotizar-envio).
  // Solo cuenta para envío a domicilio. La base cobra el precio guardado en
  // la cotización; si venció o no corresponde, rechaza con 22023 y crearPedido
  // lanza ErrorCotizacionVencida.
  cotizacionEnvio?: string | null
}

// Mensaje cuando la clienta cargó un cupón pero la base todavía no acepta
// p_cupon (falta la migración de cupones): se corta en vez de cobrar sin
// descuento a sus espaldas.
export const MENSAJE_CUPON_NO_DISPONIBLE = 'No pudimos aplicar el cupón, intentá más tarde.'


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
// su número. La base recalcula precios, subtotal, descuento (cupón) y costo de
// envío (zona) con los valores vigentes y descuenta el stock; p_subtotal se
// sigue mandando por compatibilidad.
//
// Orden de despliegue (el frontend puede llegar antes que las migraciones):
//   - Con cupón: firma de 14 parámetros (con p_cupon). Si la base todavía no
//     la tiene, NO se reintenta sin el cupón (sería cobrar sin el descuento
//     prometido): se corta con MENSAJE_CUPON_NO_DISPONIBLE.
//   - Sin cupón: firma de 13 parámetros (p_cupon tiene default null en la
//     base nueva, así que sirve para las dos). Si tampoco existe, se reintenta
//     UNA vez con la firma anterior de 11 parámetros; se pierde la provincia y
//     la protección contra duplicados, igual que antes de esa migración.
//   - Con cotización de transportista: se suma p_cotizacion_envio (y p_cupon,
//     null si no hay). Si la base todavía no acepta ese parámetro, se sigue
//     como si no hubiera cotización (el envío se cobra por zona, como antes
//     de los transportistas); los totales reales se leen después del alta.
//
// Los errores de la base (falta de stock, cupón vencido…) ya vienen redactados
// para mostrarse tal cual.
export async function crearPedido({
  datos,
  items,
  origen = 'checkout',
  idempotencyKey,
  cupon,
  cotizacionEnvio,
}: NuevoPedido): Promise<number> {
  const envio = datos.entrega === 'envio'
  const firma11 = {
    p_nombre: datos.nombre.trim(),
    p_telefono: datos.telefono.trim(),
    p_email: textoOpcional(datos.email),
    p_entrega: datos.entrega,
    p_direccion: envio ? textoOpcional(datos.direccion) : null,
    p_localidad: envio ? textoOpcional(datos.localidad) : null,
    p_cp: envio ? textoOpcional(datos.cp) : null,
    p_notas: textoOpcional(datos.notas),
    // Ordenados por id: crear_pedido bloquea cada producto en este orden, y si
    // dos compras simultáneas los bloquean en orden distinto se traban
    // (deadlock) y una de las dos falla con un error técnico.
    p_items: [...items]
      .sort((a, b) => {
        const ka = `${a.id}:${a.talleId ?? ''}`
        const kb = `${b.id}:${b.talleId ?? ''}`
        return ka < kb ? -1 : ka > kb ? 1 : 0
      })
      .map((i) => ({
        id: i.id,
        nombre: i.nombre,
        precio: i.precio,
        cantidad: i.cantidad,
        // Producto con talles: crear_pedido descuenta de este talle.
        ...(i.talleId ? { talle_id: i.talleId } : {}),
      })),
    p_subtotal: calcularSubtotal(items),
    p_origen: origen,
  }
  const firma13 = {
    ...firma11,
    p_provincia: envio ? textoOpcional(datos.provincia) : null,
    p_idempotency_key: idempotencyKey ?? null,
  }
  const codigoCupon = textoOpcional(cupon)?.toUpperCase() ?? null
  const cotizacion = envio ? textoOpcional(cotizacionEnvio) : null

  let data: unknown
  let error: ErrorRpc | null = null
  let resuelto = false
  if (cotizacion) {
    ;({ data, error } = await supabase.rpc('crear_pedido', {
      ...firma13,
      p_cupon: codigoCupon,
      p_cotizacion_envio: cotizacion,
    }))
    if (error && esFirmaInexistente(error)) {
      console.warn(
        `${PREFIJO_LOG} crear_pedido todavía no acepta p_cotizacion_envio (falta aplicar la ` +
          'migración de transportistas): se registra con el envío por zona.',
        error.message,
      )
    } else {
      if (error && esCotizacionVencida(error)) throw new ErrorCotizacionVencida()
      resuelto = true
    }
  }
  if (!resuelto) {
    if (codigoCupon) {
      ;({ data, error } = await supabase.rpc('crear_pedido', { ...firma13, p_cupon: codigoCupon }))
      if (error && esFirmaInexistente(error)) {
        console.warn(
          `${PREFIJO_LOG} crear_pedido todavía no acepta p_cupon (falta aplicar la migración ` +
            'de cupones): se cancela el alta para no cobrar sin el descuento.',
          error.message,
        )
        throw new Error(MENSAJE_CUPON_NO_DISPONIBLE)
      }
    } else {
      ;({ data, error } = await supabase.rpc('crear_pedido', firma13))
      if (error && esFirmaInexistente(error)) {
        console.warn(
          `${PREFIJO_LOG} crear_pedido todavía no acepta p_provincia / p_idempotency_key ` +
            '(falta aplicar la migración): se reintenta con la firma anterior.',
          error.message,
        )
        ;({ data, error } = await supabase.rpc('crear_pedido', firma11))
      }
    }
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

// Lee el pedido recién creado (la clienta puede leer los suyos por RLS) para
// mostrar los totales que calculó la base: descuento del cupón, costo de envío
// de la zona y total. Devuelve null si no se puede leer: quien llama se queda
// con su estimación.
export async function leerPedidoCreado(numero: number, userId: string): Promise<Pedido | null> {
  try {
    const { data, error } = await supabase
      .from('pedidos')
      .select('*')
      .eq('numero', numero)
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) return null
    return data as Pedido
  } catch {
    return null
  }
}

// ---- Mis pedidos -----------------------------------------------------------------

// El RPC no existe todavía (migración *_mis_pedidos.sql sin aplicar).
function faltaRpc(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883'
}

/**
 * Pedidos de la clienta logueada: los de la web con su cuenta y los cargados
 * a mano (WhatsApp) con su email confirmado (RPC mis_pedidos). Si la base
 * todavía no tiene el RPC, solo los de su cuenta, como antes. Lanza si falla.
 */
export async function cargarMisPedidos(userId: string): Promise<Pedido[]> {
  const { data, error } = await supabase.rpc('mis_pedidos')
  if (!error) return (data ?? []) as Pedido[]
  if (!faltaRpc(error)) throw error
  const viejo = await supabase
    .from('pedidos')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (viejo.error) throw viejo.error
  return (viejo.data ?? []) as Pedido[]
}

/** Un pedido de la clienta por número (comprobante). null si no es suyo o falla. */
export async function leerMiPedido(numero: number, userId: string): Promise<Pedido | null> {
  try {
    const { data, error } = await supabase.rpc('mis_pedidos', { p_numero: numero })
    if (error) return faltaRpc(error) ? await leerPedidoCreado(numero, userId) : null
    const filas = (data ?? []) as Pedido[]
    return filas[0] ?? null
  } catch {
    return null
  }
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

// Nombre de cada estado en el panel (el mismo que usan los filtros y, del
// lado de la clienta, "Mis pedidos").
export const ETIQUETA_ESTADO: Record<EstadoPedido, string> = {
  nuevo: 'Nuevo',
  confirmado: 'En preparación',
  enviado: 'Enviado',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
}
