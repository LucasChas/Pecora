import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import { money } from './format'
import { aNumero } from './cupones'
import type { ServicioEnvio, SucursalEnvio, Transportista } from '../types'

// ============================================================================
// Cotización de envíos con transportistas (Andreani y Correo Argentino) vía la
// Edge Function cotizar-envio.
//
// La función cotiza con las credenciales de cada transportista (secretos de
// Supabase) y guarda cada opción con un id (cotizacion_id) que vence a los 30
// minutos y queda atado al CP, la provincia y los ítems. crear_pedido recibe
// ese id (p_cotizacion_envio) y cobra el precio guardado: la base sigue siendo
// la fuente de verdad.
//
// Si la función no está desplegada, falla o ningún transportista tiene
// credenciales, el checkout sigue con el envío por zona (lib/envios) como
// siempre, sin mostrar errores a la clienta.
// ============================================================================

export const NOMBRE_FUNCION_COTIZAR = 'cotizar-envio'

const PREFIJO_LOG = '[transportistas]'

// Vigencia de una cotización en el servidor.
export const VIGENCIA_COTIZACION_MS = 30 * 60 * 1000
// Margen de seguridad: se recotiza un poco antes de que venza en el servidor
// (el pedido puede tardar unos segundos en llegar).
export const MARGEN_VENCIMIENTO_MS = 2 * 60 * 1000
// Tope de espera de la función (los transportistas pueden tardar).
export const TIMEOUT_COTIZACION_MS = 15_000

export const MENSAJE_COTIZACION_VENCIDA = 'La cotización venció, volvé a cotizar'

export const TRANSPORTISTAS: readonly Transportista[] = ['andreani', 'correo_argentino']

const NOMBRE_TRANSPORTISTA: Record<Transportista, string> = {
  andreani: 'Andreani',
  correo_argentino: 'Correo Argentino',
}

const TEXTO_SERVICIO: Record<ServicioEnvio, string> = {
  domicilio: 'a domicilio',
  sucursal: 'a sucursal',
}

export function esTransportista(valor: unknown): valor is Transportista {
  return valor === 'andreani' || valor === 'correo_argentino'
}

export function esServicioEnvio(valor: unknown): valor is ServicioEnvio {
  return valor === 'domicilio' || valor === 'sucursal'
}

export function nombreTransportista(t: Transportista): string {
  return NOMBRE_TRANSPORTISTA[t]
}

// ---- Pedido de cotización ------------------------------------------------------

export interface ItemCotizable {
  producto_id: string
  cantidad: number
}

export interface PedidoCotizacion {
  cp: string
  provincia: string
  items: ItemCotizable[]
}

// Solo dígitos y letras, en mayúsculas: "x5000 abc" -> "X5000ABC".
export function normalizarCp(cp: string): string {
  return cp.replace(/[^0-9a-z]/gi, '').toUpperCase()
}

// Arma el cuerpo del POST. Devuelve null si todavía no se puede cotizar: hace
// falta la provincia y un CP con al menos 4 dígitos, y algún ítem válido.
// Los ítems repetidos se suman y se ordenan por id, así el mismo carrito da
// siempre el mismo pedido (y la misma clave).
export function armarPedidoCotizacion(
  cp: string,
  provincia: string,
  items: readonly { id: string; cantidad: number }[],
): PedidoCotizacion | null {
  const cpLimpio = normalizarCp(cp)
  const provinciaLimpia = provincia.trim()
  if (provinciaLimpia === '' || cpLimpio.replace(/\D/g, '').length < 4) return null

  const cantidades = new Map<string, number>()
  for (const item of items) {
    const cantidad = Math.floor(item.cantidad)
    if (typeof item.id !== 'string' || item.id === '' || !(cantidad > 0)) continue
    cantidades.set(item.id, (cantidades.get(item.id) ?? 0) + cantidad)
  }
  if (cantidades.size === 0) return null

  const lista = [...cantidades]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([producto_id, cantidad]) => ({ producto_id, cantidad }))
  return { cp: cpLimpio, provincia: provinciaLimpia, items: lista }
}

// Clave que identifica a qué destino y carrito corresponde una cotización.
export function claveCotizacion(pedido: PedidoCotizacion): string {
  const items = pedido.items.map((i) => `${i.producto_id}x${i.cantidad}`).join(',')
  return `${pedido.cp}|${pedido.provincia.toLowerCase()}|${items}`
}

// ---- Respuesta ------------------------------------------------------------------

export interface OpcionEnvio {
  cotizacionId: string
  transportista: Transportista
  servicio: ServicioEnvio
  precio: number
  // Texto libre del transportista ("3 a 5 días"), o null si no lo informa.
  plazo: string | null
  // Solo en las opciones a sucursal.
  sucursal: SucursalEnvio | null
}

export interface ZonaCotizada {
  precio: number
  nombre: string
}

export interface CotizacionTransportistas {
  opciones: OpcionEnvio[]
  zona: ZonaCotizada | null
  transportistasActivos: Transportista[]
}

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const limpio = valor.trim()
  return limpio === '' ? null : limpio
}

// Plazo como texto: "3 a 5 días" tal cual; un número solo pasa a "N días".
export function normalizarPlazo(valor: unknown): string | null {
  if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) {
    const n = Math.round(valor)
    return n === 1 ? '1 día' : `${n} días`
  }
  const t = texto(valor)
  if (t === null) return null
  if (/^\d+$/.test(t)) return t === '1' ? '1 día' : `${Number(t)} días`
  return t
}

function normalizarSucursal(valor: unknown): SucursalEnvio | null {
  if (!valor || typeof valor !== 'object') return null
  const s = valor as Record<string, unknown>
  const id = texto(s.id) ?? (typeof s.id === 'number' ? String(s.id) : null)
  const nombre = texto(s.nombre)
  if (id === null || nombre === null) return null
  return { id, nombre, direccion: texto(s.direccion) ?? '' }
}

function normalizarOpcion(valor: unknown): OpcionEnvio | null {
  if (!valor || typeof valor !== 'object') return null
  const o = valor as Record<string, unknown>
  const cotizacionId = texto(o.cotizacion_id)
  if (cotizacionId === null) return null
  if (!esTransportista(o.transportista) || !esServicioEnvio(o.servicio)) return null
  // Precio: número (o texto numérico) y no negativo; sin precio no se ofrece.
  const crudo = o.precio
  const precio =
    typeof crudo === 'number' ? crudo : typeof crudo === 'string' && crudo.trim() !== '' ? Number(crudo) : NaN
  if (!Number.isFinite(precio) || precio < 0) return null
  const sucursal = normalizarSucursal(o.sucursal)
  // Una opción a sucursal sin sucursal no se puede elegir.
  if (o.servicio === 'sucursal' && sucursal === null) return null
  return {
    cotizacionId,
    transportista: o.transportista,
    servicio: o.servicio,
    precio,
    plazo: normalizarPlazo(o.plazo),
    sucursal: o.servicio === 'sucursal' ? sucursal : null,
  }
}

function normalizarActivos(valor: unknown): Transportista[] {
  if (!Array.isArray(valor)) return []
  return TRANSPORTISTAS.filter((t) => valor.includes(t))
}

// Normaliza la respuesta del POST. Descarta lo que no tenga forma válida (no
// confía en la función) y las opciones repetidas por id.
export function normalizarCotizacion(data: unknown): CotizacionTransportistas {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const vistas = new Set<string>()
  const opciones: OpcionEnvio[] = []
  for (const crudo of Array.isArray(d.opciones) ? d.opciones : []) {
    const op = normalizarOpcion(crudo)
    if (!op || vistas.has(op.cotizacionId)) continue
    vistas.add(op.cotizacionId)
    opciones.push(op)
  }
  let zona: ZonaCotizada | null = null
  if (d.zona && typeof d.zona === 'object') {
    const z = d.zona as Record<string, unknown>
    const nombre = texto(z.nombre)
    if (nombre !== null) zona = { nombre, precio: Math.max(0, aNumero(z.precio)) }
  }
  return {
    opciones: ordenarOpciones(opciones),
    zona,
    transportistasActivos: normalizarActivos(d.transportistas_activos),
  }
}

// ---- Plazos y comparaciones -------------------------------------------------------

// Días de un plazo en texto: "3 a 5 días" -> {min 3, max 5}; "48 hs" -> 2 días.
// null si no trae números.
export function diasPlazo(plazo: string | null): { min: number; max: number } | null {
  if (!plazo) return null
  const numeros = (plazo.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.')))
  if (numeros.length === 0) return null
  // "48 hs", "72 horas", "24h" (sin confundir con "hábiles").
  const enHoras = /\d\s*(hs|horas?|h)(?![a-záéíóúñ])/i.test(plazo)
  const dias = numeros.map((n) => (enHoras ? Math.ceil(n / 24) : n))
  return { min: Math.min(...dias), max: Math.max(...dias) }
}

// Orden estable para mostrar: por precio, después por plazo y por nombre.
export function ordenarOpciones(opciones: readonly OpcionEnvio[]): OpcionEnvio[] {
  return [...opciones].sort((a, b) => {
    if (a.precio !== b.precio) return a.precio - b.precio
    const pa = diasPlazo(a.plazo)?.max ?? Infinity
    const pb = diasPlazo(b.plazo)?.max ?? Infinity
    if (pa !== pb) return pa - pb
    return etiquetaOpcion(a).localeCompare(etiquetaOpcion(b), 'es')
  })
}

export function masEconomica(opciones: readonly OpcionEnvio[]): OpcionEnvio | null {
  let mejor: OpcionEnvio | null = null
  for (const op of opciones) if (!mejor || op.precio < mejor.precio) mejor = op
  return mejor
}

// La de menor plazo máximo (a igual plazo, la más barata). null si ninguna
// informa plazo.
export function masRapida(opciones: readonly OpcionEnvio[]): OpcionEnvio | null {
  let mejor: OpcionEnvio | null = null
  let mejorDias = Infinity
  for (const op of opciones) {
    const d = diasPlazo(op.plazo)
    if (!d) continue
    if (d.max < mejorDias || (d.max === mejorDias && mejor !== null && op.precio < mejor.precio)) {
      mejor = op
      mejorDias = d.max
    }
  }
  return mejor
}

// ---- Etiquetas -------------------------------------------------------------------

// "Andreani a domicilio"
export function etiquetaServicio(transportista: Transportista, servicio: ServicioEnvio): string {
  return `${NOMBRE_TRANSPORTISTA[transportista]} ${TEXTO_SERVICIO[servicio]}`
}

// "Andreani a domicilio · 3 a 5 días"
export function etiquetaOpcion(op: Pick<OpcionEnvio, 'transportista' | 'servicio' | 'plazo'>): string {
  const base = etiquetaServicio(op.transportista, op.servicio)
  return op.plazo ? `${base} · ${op.plazo}` : base
}

// "Sucursal Centro — Av. Colón 123"
export function etiquetaSucursal(s: SucursalEnvio): string {
  return s.direccion ? `${s.nombre} — ${s.direccion}` : s.nombre
}

// Precio de una opción: "Gratis" o "$ 4.500".
export function textoPrecioOpcion(precio: number): string {
  return precio <= 0 ? 'Gratis' : money(precio)
}

// Etiqueta del envío de un pedido ya registrado (columnas transportista,
// servicio_envio y sucursal_envio): "Andreani a sucursal" o, con conSucursal,
// "Andreani a sucursal · Sucursal Centro". null si no va con transportista.
export function etiquetaEnvioPedido(
  p: {
    transportista?: string | null
    servicio_envio?: string | null
    sucursal_envio?: string | null
  },
  conSucursal = false,
): string | null {
  if (!esTransportista(p.transportista)) return null
  const base = esServicioEnvio(p.servicio_envio)
    ? etiquetaServicio(p.transportista, p.servicio_envio)
    : NOMBRE_TRANSPORTISTA[p.transportista]
  const sucursal = conSucursal ? texto(p.sucursal_envio) : null
  return sucursal ? `${base} · ${sucursal}` : base
}

// Sucursal de destino de un pedido (solo si se envía a sucursal).
export function sucursalDePedido(p: { sucursal_envio?: string | null }): string | null {
  return texto(p.sucursal_envio)
}

// ---- Agrupado para la interfaz ------------------------------------------------------

// Un grupo por transportista + servicio. Las opciones a sucursal traen una por
// sucursal (cada una con su cotización): se eligen con un selector dentro del
// grupo. A domicilio suele haber una sola.
export interface GrupoOpciones {
  clave: string
  transportista: Transportista
  servicio: ServicioEnvio
  // Ordenadas por precio.
  opciones: OpcionEnvio[]
  precioDesde: number
  // true si las opciones del grupo no cuestan todas lo mismo ("desde $…").
  precioVariable: boolean
}

export function claveGrupo(op: Pick<OpcionEnvio, 'transportista' | 'servicio'>): string {
  return `${op.transportista}:${op.servicio}`
}

export function agruparOpciones(opciones: readonly OpcionEnvio[]): GrupoOpciones[] {
  const grupos = new Map<string, GrupoOpciones>()
  for (const op of ordenarOpciones(opciones)) {
    const clave = claveGrupo(op)
    const g = grupos.get(clave)
    if (g) {
      g.opciones.push(op)
    } else {
      grupos.set(clave, {
        clave,
        transportista: op.transportista,
        servicio: op.servicio,
        opciones: [op],
        precioDesde: op.precio,
        precioVariable: false,
      })
    }
  }
  for (const g of grupos.values()) {
    g.precioVariable = g.opciones.some((o) => o.precio !== g.precioDesde)
  }
  // El orden de los grupos sigue al de su opción más barata.
  return [...grupos.values()]
}

// Tras recotizar, la opción que corresponde a la que estaba elegida: mismo
// transportista, servicio y sucursal (el id de cotización cambia siempre).
export function opcionEquivalente(
  opciones: readonly OpcionEnvio[],
  anterior: Pick<OpcionEnvio, 'transportista' | 'servicio' | 'sucursal'>,
): OpcionEnvio | null {
  return (
    opciones.find(
      (o) =>
        o.transportista === anterior.transportista &&
        o.servicio === anterior.servicio &&
        (o.sucursal?.id ?? null) === (anterior.sucursal?.id ?? null),
    ) ?? null
  )
}

// ---- Selección en el checkout --------------------------------------------------------

// Qué eligió la clienta: el envío por zona (tarifa de la tienda), coordinarlo
// por WhatsApp (sin zona que cubra el destino) o una opción de transportista.
export type SeleccionEnvio =
  | { tipo: 'zona' }
  | { tipo: 'coordinar' }
  | { tipo: 'transportista'; cotizacionId: string }

// Selección por defecto al llegar opciones nuevas:
//   1. si había una opción de transportista elegida, su equivalente;
//   2. si había zona/coordinar elegido y sigue siendo válido, se mantiene;
//   3. si no, la más barata entre las de transportista y la zona (a igual
//      precio gana la zona, que es la tarifa propia de la tienda).
export function elegirSeleccion(
  opciones: readonly OpcionEnvio[],
  zonaCosto: number | null,
  anterior: { seleccion: SeleccionEnvio; opcion: OpcionEnvio | null } | null,
): SeleccionEnvio {
  const hayZona = zonaCosto !== null
  if (anterior) {
    const { seleccion, opcion } = anterior
    if (seleccion.tipo === 'transportista' && opcion) {
      const eq = opcionEquivalente(opciones, opcion)
      if (eq) return { tipo: 'transportista', cotizacionId: eq.cotizacionId }
    }
    if (seleccion.tipo === 'zona' && hayZona) return seleccion
    if (seleccion.tipo === 'coordinar' && !hayZona) return seleccion
  }
  const barata = masEconomica(opciones)
  if (barata && (!hayZona || barata.precio < (zonaCosto ?? 0))) {
    return { tipo: 'transportista', cotizacionId: barata.cotizacionId }
  }
  return hayZona ? { tipo: 'zona' } : { tipo: 'coordinar' }
}

// ---- Vigencia -----------------------------------------------------------------------

export interface CotizacionVigente {
  clave: string
  // Date.now() cuando llegó la respuesta.
  obtenidaEn: number
}

// ¿Hay que volver a cotizar? Si no hay cotización, si cambió el destino o el
// carrito (otra clave) o si está por vencer.
export function necesitaRecotizar(
  actual: CotizacionVigente | null,
  claveNueva: string | null,
  ahora: number,
  margenMs: number = MARGEN_VENCIMIENTO_MS,
): boolean {
  if (claveNueva === null) return false
  if (!actual) return true
  if (actual.clave !== claveNueva) return true
  return ahora >= actual.obtenidaEn + VIGENCIA_COTIZACION_MS - margenMs
}

// ---- Errores ------------------------------------------------------------------------

// Por qué no hay opciones de transportista. En todos los casos el checkout
// sigue con el envío por zona.
//   sin_funcion: la función no está desplegada (404).
//   red: sin respuesta (conexión, CORS, tiempo agotado).
//   error: la función respondió con error o con datos inválidos.
export type MotivoFallback = 'sin_funcion' | 'red' | 'error'

// Clasifica el error de supabase.functions.invoke.
export function clasificarErrorFuncion(error: unknown): MotivoFallback {
  if (error instanceof FunctionsHttpError) {
    const respuesta = error.context as Response | undefined
    return respuesta?.status === 404 ? 'sin_funcion' : 'error'
  }
  if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) return 'red'
  if (error instanceof Error && /failed to fetch|networkerror|network request failed|load failed|abort/i.test(error.message)) {
    return 'red'
  }
  return 'error'
}

// Error de crear_pedido: ¿la cotización venció o no corresponde al pedido?
// La base lo informa con 22023 (invalid_parameter_value) solo para eso.
export function esCotizacionVencida(error: { code?: string } | null | undefined): boolean {
  return error?.code === '22023'
}

// Lo lanza crearPedido cuando la base rechaza la cotización: el checkout
// recotiza y le pide a la clienta que confirme el precio nuevo.
export class ErrorCotizacionVencida extends Error {
  constructor(message: string = MENSAJE_COTIZACION_VENCIDA) {
    super(message)
    this.name = 'ErrorCotizacionVencida'
  }
}

// ---- Llamadas a la función -------------------------------------------------------------

export type ResultadoCotizacion =
  | { ok: true; cotizacion: CotizacionTransportistas }
  | { ok: false; motivo: MotivoFallback }

// Pide las opciones de envío. Nunca lanza: ante cualquier problema devuelve
// { ok: false } y el checkout sigue con el envío por zona.
export async function cotizarTransportistas(pedido: PedidoCotizacion): Promise<ResultadoCotizacion> {
  try {
    const { data, error } = await supabase.functions.invoke(NOMBRE_FUNCION_COTIZAR, {
      body: pedido,
      timeout: TIMEOUT_COTIZACION_MS,
    })
    if (error) {
      const motivo = clasificarErrorFuncion(error)
      if (motivo === 'error') console.warn(`${PREFIJO_LOG} No se pudo cotizar con transportistas.`, error)
      return { ok: false, motivo }
    }
    if (!data || typeof data !== 'object') {
      console.warn(`${PREFIJO_LOG} Respuesta inválida de ${NOMBRE_FUNCION_COTIZAR}.`)
      return { ok: false, motivo: 'error' }
    }
    return { ok: true, cotizacion: normalizarCotizacion(data) }
  } catch (e) {
    return { ok: false, motivo: clasificarErrorFuncion(e) }
  }
}

export type EstadoTransportistas =
  | { ok: true; activos: Transportista[] }
  | { ok: false; motivo: MotivoFallback }

// Qué transportistas tienen credenciales cargadas (GET ?estado=1), para el panel.
export async function consultarEstadoTransportistas(): Promise<EstadoTransportistas> {
  try {
    const { data, error } = await supabase.functions.invoke(`${NOMBRE_FUNCION_COTIZAR}?estado=1`, {
      method: 'GET',
      timeout: TIMEOUT_COTIZACION_MS,
    })
    if (error) return { ok: false, motivo: clasificarErrorFuncion(error) }
    if (!data || typeof data !== 'object') return { ok: false, motivo: 'error' }
    return {
      ok: true,
      activos: normalizarActivos((data as Record<string, unknown>).transportistas_activos),
    }
  } catch (e) {
    return { ok: false, motivo: clasificarErrorFuncion(e) }
  }
}

// ---- Peso y medidas del producto (panel) ------------------------------------------------

export interface MedidasEnvio {
  peso_g: number | null
  alto_cm: number | null
  ancho_cm: number | null
  largo_cm: number | null
}

export interface FormMedidas {
  peso: string
  alto: string
  ancho: string
  largo: string
}

// Topes razonables para una prenda o paquete (evitan errores de tipeo como
// cargar kilos en gramos al revés).
const PESO_MAX_G = 50_000
const MEDIDA_MAX_CM = 300

function numeroCampo(valor: string): number | null | 'invalido' {
  const limpio = valor.trim().replace(',', '.')
  if (limpio === '') return null
  const n = Number(limpio)
  return Number.isFinite(n) ? n : 'invalido'
}

// Campos del formulario -> columnas. Vacío = null (no se cotiza con eso).
export function parsearMedidas(
  f: FormMedidas,
): { ok: true; datos: MedidasEnvio } | { ok: false; mensaje: string } {
  const peso = numeroCampo(f.peso)
  if (peso === 'invalido' || (peso !== null && (peso <= 0 || peso > PESO_MAX_G))) {
    return { ok: false, mensaje: `El peso va en gramos, entre 1 y ${PESO_MAX_G.toLocaleString('es-AR')}.` }
  }
  const medidas: Record<'alto' | 'ancho' | 'largo', number | null> = { alto: null, ancho: null, largo: null }
  for (const campo of ['alto', 'ancho', 'largo'] as const) {
    const n = numeroCampo(f[campo])
    if (n === 'invalido' || (n !== null && (n <= 0 || n > MEDIDA_MAX_CM))) {
      return { ok: false, mensaje: `El ${campo} va en centímetros, entre 0,1 y ${MEDIDA_MAX_CM}.` }
    }
    medidas[campo] = n === null ? null : Math.round(n * 10) / 10
  }
  return {
    ok: true,
    datos: {
      peso_g: peso === null ? null : Math.round(peso),
      alto_cm: medidas.alto,
      ancho_cm: medidas.ancho,
      largo_cm: medidas.largo,
    },
  }
}

// Columnas -> campos del formulario.
export function formMedidasDe(p: Partial<MedidasEnvio> | null | undefined): FormMedidas {
  const campo = (v: number | null | undefined) =>
    typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
  return {
    peso: campo(p?.peso_g),
    alto: campo(p?.alto_cm),
    ancho: campo(p?.ancho_cm),
    largo: campo(p?.largo_cm),
  }
}

export function hayMedidas(m: MedidasEnvio): boolean {
  return m.peso_g !== null || m.alto_cm !== null || m.ancho_cm !== null || m.largo_cm !== null
}

// ¿El error de PostgREST dice que falta una columna (migración sin aplicar)?
// PGRST204 ("Could not find the 'peso_g' column ... in the schema cache") o
// 42703 (undefined_column) de Postgres.
export function esColumnaInexistente(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === 'PGRST204' || error.code === '42703') return true
  return /could not find the '.*' column|column .* does not exist/i.test(error.message ?? '')
}
