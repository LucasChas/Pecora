import { supabase } from './supabaseClient'
import { money } from './format'
import {
  MENSAJE_FALTA_MIGRACION,
  aNumero,
  esErrorDeRed,
  esFuncionInexistente,
  esTablaInexistente,
  primeraFila,
  type ErrorSupabase,
  type ResultadoCarga,
} from './cupones'
import type { ZonaEnvio } from '../types'

// ============================================================================
// Envío por zona: cotización en el checkout (RPC cotizar_envio) y ABM de las
// zonas en el panel (tabla zonas_envio). La base es la fuente de verdad:
// crear_pedido vuelve a calcular el costo al registrar el pedido.
// ============================================================================

const PREFIJO_LOG = '[envíos]'

export interface CotizacionEnvio {
  // true si hay una zona que cubre el destino (el costo es conocido).
  disponible: boolean
  zonaId: string | null
  zonaNombre: string | null
  costo: number
  gratis: boolean
  mensaje: string | null
}

// Sin zona (o sin la migración): el envío se coordina por WhatsApp.
export const ENVIO_A_COORDINAR: CotizacionEnvio = {
  disponible: false,
  zonaId: null,
  zonaNombre: null,
  costo: 0,
  gratis: false,
  mensaje: null,
}

// ¿Hay datos suficientes para cotizar? Provincia elegida o un CP de 4+ dígitos.
export function puedeCotizar(provincia: string, cp: string): boolean {
  return provincia.trim() !== '' || cp.replace(/\D/g, '').length >= 4
}

// Cotiza el envío (RPC cotizar_envio, anon y autenticada). Nunca lanza: ante
// cualquier problema devuelve "a coordinar", que es lo que pasaba antes de
// existir las zonas.
export async function cotizarEnvio(
  provincia: string,
  cp: string,
  subtotal: number,
): Promise<CotizacionEnvio> {
  let respuesta: { data: unknown; error: ErrorSupabase | null }
  try {
    respuesta = await supabase.rpc('cotizar_envio', {
      p_provincia: provincia.trim() || null,
      p_cp: cp.trim() || null,
      p_subtotal: subtotal,
    })
  } catch {
    return ENVIO_A_COORDINAR
  }
  const { data, error } = respuesta
  if (error) {
    if (esFuncionInexistente(error, 'cotizar_envio')) {
      console.warn(`${PREFIJO_LOG} cotizar_envio no existe todavía (falta la migración).`, error.message)
    } else if (!esErrorDeRed(error)) {
      console.warn(`${PREFIJO_LOG} No se pudo cotizar el envío.`, error.message)
    }
    return ENVIO_A_COORDINAR
  }

  const fila = primeraFila(data)
  if (!fila) return ENVIO_A_COORDINAR
  const mensaje = typeof fila.mensaje === 'string' && fila.mensaje.trim() !== '' ? fila.mensaje : null
  if (fila.disponible !== true) return { ...ENVIO_A_COORDINAR, mensaje }
  const gratis = fila.gratis === true
  return {
    disponible: true,
    zonaId: typeof fila.zona_id === 'string' ? fila.zona_id : null,
    zonaNombre: typeof fila.zona_nombre === 'string' && fila.zona_nombre !== '' ? fila.zona_nombre : null,
    costo: gratis ? 0 : Math.max(0, aNumero(fila.costo)),
    gratis,
    mensaje,
  }
}

// Texto del costo: "Gratis", "$ 2.500" o "A coordinar".
export function textoCotizacion(c: CotizacionEnvio): string {
  if (!c.disponible) return 'A coordinar'
  if (c.gratis || c.costo <= 0) return 'Gratis'
  return money(c.costo)
}

// ---- Panel: zonas ------------------------------------------------------------------

// "50, 51 ,5152, 50" -> ["50", "51", "5152"]: solo dígitos, sin repetidos.
export function parsearPrefijos(texto: string): string[] {
  const vistos = new Set<string>()
  for (const parte of texto.split(/[\s,;]+/)) {
    const limpio = parte.replace(/\D/g, '')
    if (limpio !== '') vistos.add(limpio)
  }
  return [...vistos]
}

// Resumen de la cobertura para la lista: "Córdoba, Santa Fe · CP 50, 51".
export function describirCobertura(zona: Pick<ZonaEnvio, 'provincias' | 'cp_prefijos'>): string {
  const partes: string[] = []
  const provincias = zona.provincias ?? []
  const prefijos = zona.cp_prefijos ?? []
  if (provincias.length > 0) partes.push(provincias.join(', '))
  if (prefijos.length > 0) partes.push(`CP ${prefijos.join(', ')}`)
  return partes.length > 0 ? partes.join(' · ') : 'Sin cobertura cargada'
}

export async function listarZonas(): Promise<ResultadoCarga<ZonaEnvio[]>> {
  const { data, error } = await supabase
    .from('zonas_envio')
    .select('*')
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })
  if (error) {
    const faltaMigracion = esTablaInexistente(error)
    return {
      ok: false,
      faltaMigracion,
      mensaje: faltaMigracion ? MENSAJE_FALTA_MIGRACION : error.message || 'No se pudieron cargar las zonas.',
    }
  }
  return { ok: true, datos: (data ?? []) as ZonaEnvio[] }
}

export type DatosZona = Omit<ZonaEnvio, 'id'>

function mensajeErrorZona(error: ErrorSupabase): string {
  if (esTablaInexistente(error)) return MENSAJE_FALTA_MIGRACION
  if (error.code === '23505') return 'Ya existe una zona con ese nombre.'
  return error.message || 'No se pudo guardar la zona.'
}

export async function guardarZona(datos: DatosZona, id?: string): Promise<string | null> {
  const { error } = id
    ? await supabase.from('zonas_envio').update(datos).eq('id', id)
    : await supabase.from('zonas_envio').insert(datos)
  return error ? mensajeErrorZona(error) : null
}

// Pausa / reactiva una zona sin tocar el resto de sus datos.
export async function activarZona(id: string, activo: boolean): Promise<string | null> {
  const { error } = await supabase.from('zonas_envio').update({ activo }).eq('id', id)
  return error ? mensajeErrorZona(error) : null
}

export async function borrarZona(id: string): Promise<string | null> {
  const { error } = await supabase.from('zonas_envio').delete().eq('id', id)
  return error ? mensajeErrorZona(error) : null
}

// Reasigna orden 0..n-1 según la posición en la lista (tras mover una zona).
export async function guardarOrden(zonas: readonly ZonaEnvio[]): Promise<string | null> {
  const cambios = zonas
    .map((z, i) => ({ z, i }))
    .filter(({ z, i }) => z.orden !== i)
    .map(({ z, i }) => supabase.from('zonas_envio').update({ orden: i }).eq('id', z.id))
  const resultados = await Promise.all(cambios)
  const error = resultados.find((r) => r.error)?.error
  return error ? mensajeErrorZona(error) : null
}

// Valida el formulario del panel. Devuelve el primer problema o null.
export function validarDatosZona(d: DatosZona): string | null {
  if (d.nombre.trim().length < 2) return 'Poné un nombre para la zona.'
  if (d.provincias.length === 0 && d.cp_prefijos.length === 0) {
    return 'Elegí al menos una provincia o cargá un prefijo de código postal.'
  }
  if (!(d.precio >= 0)) return 'El precio no puede ser negativo.'
  if (d.gratis_desde !== null && !(d.gratis_desde > 0)) return '"Gratis desde" tiene que ser mayor a 0.'
  return null
}
