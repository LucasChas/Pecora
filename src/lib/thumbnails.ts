import type { Producto } from '../types'
import { supabase } from './supabaseClient'
import { crearMiniatura } from './imageCompress'
import { conTiempoMax, correrTareas } from './tareas'
import { BUCKET_PRODUCTOS, esRutaMiniatura, rutaEnBucket, rutaMiniatura } from './images'
import { registroMiniaturas, type RegistroMiniaturas } from './miniaturasDisponibles'

// ============================================================================
// Miniaturas en Storage (solo panel admin):
// - subirOriginalConMiniatura: cada foto nueva y, en paralelo, su miniatura
//   (ProductFormSheet).
// - generarMiniaturasFaltantes: una pasada que crea las que falten (fotos
//   viejas, subidas que fallaron), comparando con el registro de disponibles.
// - crearMiniaturasAutomaticas: corre esa pasada sola en el panel (ver
//   hooks/useMiniaturasAutomaticas). Sin botón ni confirmación: deja un
//   resumen en la consola y, solo si viene fallando varias pasadas seguidas,
//   pide un aviso discreto en pantalla (necesitaAtencion).
// Las miniaturas se suben con fetch directo a Storage (ver subir) para que el
// tope de tiempo corte la subida de verdad.
// La convención de nombres y la lectura (miniaturaDe) viven en lib/images.
// ============================================================================

// Los nombres llevan un UUID y nunca se reescriben: se pueden cachear un año.
export const CACHE_INMUTABLE = '31536000'

const PREFIJO_LOG = '[Miniaturas]'

// Cómo terminó la subida de una miniatura: nueva, o ya estaba (409).
export type SubidaMiniatura = 'generada' | 'yaExistia'

type FotosDeProducto = Pick<Producto, 'imagenes' | 'imagen_url'>

// ---- En proceso ----------------------------------------------------------------

// Originales cuya miniatura se está generando o subiendo ahora mismo (junto
// con la foto nueva o en una pasada): una pasada que se solapa no los repite.
// Cada entrada lleva su propia marca, para que una tarea vieja que termina
// tarde no suelte la de otra más nueva.
const enProceso = new Map<string, object>()

// Corre `fn` con `rutaOriginal` marcada como en proceso. La marca se suelta al
// terminar o apenas se aborta `signal` (vencido el tope): así una pasada
// posterior la puede reintentar aunque lo abortado tarde en terminar.
async function conEnProceso<T>(
  rutaOriginal: string,
  signal: AbortSignal,
  fn: () => Promise<T>,
): Promise<T> {
  const marca = {}
  enProceso.set(rutaOriginal, marca)
  const soltar = () => {
    if (enProceso.get(rutaOriginal) === marca) enProceso.delete(rutaOriginal)
  }
  signal.addEventListener('abort', soltar, { once: true })
  try {
    return await fn()
  } finally {
    signal.removeEventListener('abort', soltar)
    soltar()
  }
}

// ---- Junto con cada foto nueva ------------------------------------------------

// Tope de la miniatura que acompaña a una foto nueva: vencido, la subida se
// corta (fetch abortable) y la pasada automática la genera más tarde.
export const TOPE_MINIATURA_AL_GUARDAR_MS = 20_000

// Sube el original de una foto nueva y, en paralelo, su miniatura. Solo se
// espera al original, que es lo único que necesita el producto:
// - si falla, rechaza en el acto, sin esperar a la miniatura. Esa miniatura
//   puede terminar sola en segundo plano y quedar huérfana: es inofensivo
//   (ningún producto apunta a su original, así que nadie la pide);
// - si sale bien, tampoco la espera: "Guardando…" dura lo que tarda el
//   original. La miniatura sigue sola (con su tope), se anota en el registro
//   al terminar (la grilla la toma sola; hasta entonces se ve el original) y,
//   mientras sube, la pasada automática no la repite (enProceso).
export async function subirOriginalConMiniatura(rutaOriginal: string, original: Blob): Promise<void> {
  const subida = supabase.storage.from(BUCKET_PRODUCTOS).upload(rutaOriginal, original, {
    cacheControl: CACHE_INMUTABLE,
    upsert: false,
    contentType: 'image/jpeg',
  })
  void subirMiniatura(rutaOriginal, original) // nunca rechaza
  const { error } = await subida
  if (error) throw error
}

// Genera y sube la miniatura de un original recién subido y la anota en el
// registro. Nunca rechaza: si algo falla se avisa en consola y el producto se
// guarda igual (se ve el original hasta que la pasada automática la cree).
export async function subirMiniatura(
  rutaOriginal: string,
  fuente: Blob,
  registro: RegistroMiniaturas = registroMiniaturas,
): Promise<boolean> {
  const ruta = rutaMiniatura(rutaOriginal)
  const r = await conTiempoMax(
    (signal) =>
      conEnProceso(rutaOriginal, signal, async () => {
        const miniatura = await crearMiniatura(fuente)
        if (signal.aborted) throw new Error('cancelada')
        await subir(ruta, miniatura, signal)
        registro.agregar(ruta)
      }),
    TOPE_MINIATURA_AL_GUARDAR_MS,
  )
  if (!r.ok) {
    console.warn(`${PREFIJO_LOG} No se pudo subir la miniatura de "${rutaOriginal}" (${r.motivo}).`)
  }
  return r.ok
}

// ---- Una pasada: generar las que faltan ------------------------------------------

// De a 2 (no más: cada foto se decodifica entera en memoria y en celulares
// viejos eso pesa) y con tope por foto.
export const A_LA_VEZ = 2
export const TOPE_POR_FOTO_MS = 45_000

export type GenerarUna = (rutaOriginal: string, signal: AbortSignal) => Promise<SubidaMiniatura>

export interface ResumenPasada {
  total: number // originales usados por los productos
  faltaban: number // sin miniatura al empezar
  generadas: number
  yaExistian: number // 409: estaban aunque el listado no las mostrara
  errores: number
  pendientes: number // no llegaron a arrancar (se detuvo la pasada)
  // Hubo listado con qué comparar (sin listado no se intenta nada).
  listada: boolean
  // Se pudo listar y no quedó nada sin intentar: cuenta como pasada completa.
  completa: boolean
}

export interface OpcionesPasada {
  // Deja de arrancar fotos nuevas (las que están en curso terminan solas).
  detener?: AbortSignal
  registro?: RegistroMiniaturas
  generar?: GenerarUna
  concurrencia?: number
  tiempoMax?: number
}

// Para cada original (ruta dentro del bucket) sin miniatura según el registro
// (listado fresco), la genera y la sube. Idempotente: nunca pisa nada
// (upsert: false) y un 409 cuenta como lista. Nunca toca originales ni la
// base. Nunca rechaza. Se saltea lo que ya está en proceso (otra pasada, o la
// miniatura de una foto recién subida).
export async function generarMiniaturasFaltantes(
  rutas: string[],
  opciones: OpcionesPasada = {},
): Promise<ResumenPasada> {
  const registro = opciones.registro ?? registroMiniaturas
  const generar = opciones.generar ?? generarUna
  const originales = Array.from(new Set(rutas))
  const resumen: ResumenPasada = {
    total: originales.length,
    faltaban: 0,
    generadas: 0,
    yaExistian: 0,
    errores: 0,
    pendientes: 0,
    listada: false,
    completa: false,
  }

  const disponibles = await registro.cargar(true)
  if (!disponibles) return resumen // sin listado no se sabe qué falta
  resumen.listada = true

  const faltan = originales.filter((r) => !disponibles.has(rutaMiniatura(r)) && !enProceso.has(r))
  resumen.faltaban = faltan.length

  // Vencido el tope, conTiempoMax aborta `signal` antes de liberar el carril:
  // la descarga y la subida (fetch) se cortan en ese momento, así que nunca
  // quedan más de `concurrencia` en la red, y la marca de enProceso se suelta
  // para que otra pasada la pueda reintentar.
  const arrancadas = new Set<string>()
  const resultados = await correrTareas(
    faltan,
    (ruta, signal) => {
      arrancadas.add(ruta)
      return conEnProceso(ruta, signal, async () => {
        const subida = await generar(ruta, signal)
        // Aunque llegue pasado el tope, si quedó subida se anota igual.
        registro.agregar(rutaMiniatura(ruta))
        return subida
      })
    },
    {
      concurrencia: opciones.concurrencia ?? A_LA_VEZ,
      tiempoMax: opciones.tiempoMax ?? TOPE_POR_FOTO_MS,
      detener: opciones.detener,
    },
  )

  resultados.forEach((r, i) => {
    if (r.ok) {
      if (r.valor === 'generada') resumen.generadas++
      else resumen.yaExistian++
    } else if (!arrancadas.has(faltan[i])) {
      resumen.pendientes++
    } else {
      resumen.errores++
      console.warn(`${PREFIJO_LOG} Sin miniatura para "${faltan[i]}" (${r.motivo}).`)
    }
  })
  resumen.completa = resumen.pendientes === 0
  console.info(textoResumen(resumen))
  if (resumen.yaExistian > 0 && resumen.yaExistian === resumen.faltaban) {
    console.warn(
      `${PREFIJO_LOG} El listado de Storage no mostraba ${resumen.yaExistian} miniatura(s) que ya ` +
        'existían: revisá que siga la política de lectura del bucket "productos".',
    )
  }
  return resumen
}

function textoResumen(r: ResumenPasada): string {
  if (r.faltaban === 0) return `${PREFIJO_LOG} Todas las fotos tienen miniatura (${r.total}).`
  return (
    `${PREFIJO_LOG} ${r.generadas} generadas, ${r.yaExistian} ya estaban, ${r.errores} con error` +
    (r.pendientes > 0 ? `, ${r.pendientes} para más tarde` : '') +
    ` (de ${r.faltaban} sin miniatura).`
  )
}

// Baja el original (URL pública), lo achica y sube la miniatura.
async function generarUna(rutaOriginal: string, signal: AbortSignal): Promise<SubidaMiniatura> {
  const { data } = supabase.storage.from(BUCKET_PRODUCTOS).getPublicUrl(rutaOriginal)
  const respuesta = await fetch(data.publicUrl, { mode: 'cors', signal })
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status} al bajar el original`)
  const miniatura = await crearMiniatura(await respuesta.blob())
  if (signal.aborted) throw new Error('cancelada')
  return subir(rutaMiniatura(rutaOriginal), miniatura, signal)
}

// Sube una miniatura sin pisar nada (x-upsert: false). Si ya existía (otra
// pestaña, una pasada anterior), cuenta como lista.
//
// Va con fetch directo a la API de Storage y no con storage.upload(), que no
// acepta AbortSignal: así, al abortarse `signal` (tope vencido), la subida se
// corta de verdad en vez de seguir colgada por detrás. Mismos encabezados que
// arma supabase-js (token de la sesión, o la clave anon si no hay sesión).
async function subir(ruta: string, miniatura: Blob, signal: AbortSignal): Promise<SubidaMiniatura> {
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
  const clave = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '')
  const token = await hastaAbortar(tokenDeAcceso(clave), signal)
  const respuesta = await fetch(`${base}/storage/v1/object/${BUCKET_PRODUCTOS}/${codificarRuta(ruta)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: clave,
      'x-upsert': 'false',
      'content-type': 'image/jpeg',
      'cache-control': `max-age=${CACHE_INMUTABLE}`,
    },
    body: miniatura,
    signal,
  })
  if (respuesta.ok) return 'generada'
  const cuerpo = await cuerpoDeError(respuesta)
  const mensaje = [cuerpo.error, cuerpo.message].filter(Boolean).join(': ')
  if (yaExiste({ status: respuesta.status, statusCode: cuerpo.statusCode, message: mensaje })) {
    return 'yaExistia'
  }
  throw new Error(`HTTP ${respuesta.status}${mensaje ? ` ${mensaje}` : ''}`)
}

async function tokenDeAcceso(claveAnon: string): Promise<string> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? claveAnon
}

// Cuerpo de error de Storage: { statusCode: "409", error: "Duplicate",
// message: "The resource already exists" } (ver StorageApiError de
// storage-js). Si no es JSON (o se cortó), queda vacío.
async function cuerpoDeError(
  respuesta: Response,
): Promise<{ statusCode?: string; error: string; message: string }> {
  try {
    const valor: unknown = await respuesta.json()
    if (typeof valor === 'object' && valor !== null) {
      const { statusCode, error, message } = valor as Record<string, unknown>
      return {
        statusCode: statusCode == null ? undefined : String(statusCode),
        error: typeof error === 'string' ? error : '',
        message: typeof message === 'string' ? message : '',
      }
    }
  } catch {
    // Sin cuerpo JSON: alcanza con el código HTTP.
  }
  return { error: '', message: '' }
}

// Cada tramo codificado ("c d#1.jpg" -> "c%20d%231.jpg"); las barras quedan.
function codificarRuta(ruta: string): string {
  return ruta.split('/').map(encodeURIComponent).join('/')
}

// La promesa, o un rechazo apenas se aborta `signal` (lo que quede colgado no
// retiene la tarea).
function hastaAbortar<T>(promesa: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('cancelada'))
  return new Promise<T>((resolve, reject) => {
    const alAbortar = () => reject(new Error('cancelada'))
    signal.addEventListener('abort', alAbortar, { once: true })
    promesa.then(
      (valor) => {
        signal.removeEventListener('abort', alAbortar)
        resolve(valor)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', alAbortar)
        reject(error)
      },
    )
  })
}

// Storage contesta un duplicado con statusCode "409" (el HTTP puede ser 400).
export function yaExiste(error: { message?: string; statusCode?: string; status?: number }): boolean {
  return (
    error.statusCode === '409' ||
    error.status === 409 ||
    /already exists|duplicate/i.test(error.message ?? '')
  )
}

// Rutas de originales de nuestro bucket usadas por los productos, sin
// repetir, en el orden de los productos (las primeras de la grilla primero).
export function rutasOriginales(productos: FotosDeProducto[]): string[] {
  const rutas = new Set<string>()
  for (const p of productos) {
    for (const url of [...(p.imagenes ?? []), p.imagen_url]) {
      const ruta = url ? rutaEnBucket(url) : null
      if (ruta && !esRutaMiniatura(ruta)) rutas.add(ruta)
    }
  }
  return Array.from(rutas)
}

// Firma corta del conjunto de fotos (no depende del orden): cambia solo si se
// agrega o se quita alguna. FNV-1a de 32 bits, más la cantidad.
export function firmaDeRutas(rutas: string[]): string {
  const ordenadas = Array.from(new Set(rutas)).sort()
  let h = 0x811c9dc5
  const mezclar = (codigo: number) => {
    h ^= codigo
    h = Math.imul(h, 0x01000193) >>> 0
  }
  for (const ruta of ordenadas) {
    for (let i = 0; i < ruta.length; i++) mezclar(ruta.charCodeAt(i))
    mezclar(10) // separador: ["ab","c"] no firma igual que ["a","bc"]
  }
  return `${ordenadas.length}-${h.toString(36)}`
}

// ---- Automáticas: cuándo correr la pasada -----------------------------------------

// Se espera a que el panel esté tranquilo antes de empezar.
export const ESPERA_REPOSO_MS = 5_000
// Como mucho una pasada completa cada 30 min, salvo que cambien las fotos.
export const INTERVALO_PASADAS_MS = 30 * 60_000
export const CLAVE_ULTIMA_PASADA = 'pecora-miniaturas-ultima-pasada'
// Aviso discreto en el panel si la pasada viene fallando: tras esta cantidad
// de pasadas seguidas con problemas (contador en localStorage, así cuenta entre
// visitas). Una pasada completa y sin problemas lo vuelve a cero.
export const PASADAS_CON_PROBLEMAS_PARA_AVISAR = 3
export const CLAVE_PASADAS_CON_PROBLEMAS = 'pecora-miniaturas-pasadas-con-problemas'

// ¿La pasada terminó con problemas? Sin listado, alguna foto con error (o
// vencida), o todas las que "faltaban" ya existían: el listado de Storage no
// las muestra (la política de lectura del bucket se rompió).
export function pasadaConProblemas(r: ResumenPasada): boolean {
  return !r.listada || r.errores > 0 || (r.yaExistian > 0 && r.yaExistian === r.faltaban)
}

type AlmacenTexto = Pick<Storage, 'getItem' | 'setItem'>

export interface DocumentoVisible {
  readonly visibilityState: DocumentVisibilityState
  addEventListener(tipo: 'visibilitychange', oyente: () => void): void
  removeEventListener(tipo: 'visibilitychange', oyente: () => void): void
}

// Todo lo que toca el navegador, inyectable para probarlo en Node.
export interface EntornoAutomatico {
  pasada: (rutas: string[], detener: AbortSignal) => Promise<ResumenPasada>
  documento: DocumentoVisible | null
  ahorroDeDatos: () => boolean
  almacen: () => AlmacenTexto | null // localStorage
  ahora: () => number
  esperarReposo: (fn: () => void, ms: number) => () => void
}

export interface MiniaturasAutomaticas {
  // Fotos actuales de los productos y su firma (ver firmaDeRutas).
  actualizar: (rutas: string[], firma: string) => void
  // Van PASADAS_CON_PROBLEMAS_PARA_AVISAR pasadas seguidas con problemas.
  necesitaAtencion: () => boolean
  destruir: () => void
}

export interface OpcionesAutomaticas {
  // Se llama cuando cambia necesitaAtencion() (no después de destruir).
  alCambiarAtencion?: (necesita: boolean) => void
}

// Programa la pasada automática:
// - arranca ESPERA_REPOSO_MS después de la última actualización, cuando el
//   navegador está ocioso;
// - no corre con "ahorro de datos" activado;
// - como mucho una pasada completa cada INTERVALO_PASADAS_MS por conjunto de
//   fotos (localStorage), para no repetir el listado en cada visita;
// - en segundo plano deja de arrancar fotos nuevas y al volver retoma lo que
//   faltó (una pasada detenida no cuenta como completa);
// - cuenta las pasadas seguidas con problemas (ver pasadaConProblemas): una
//   detenida sin errores no suma ni resetea.
export function crearMiniaturasAutomaticas(
  entorno: Partial<EntornoAutomatico> = {},
  opciones: OpcionesAutomaticas = {},
): MiniaturasAutomaticas {
  const e: EntornoAutomatico = { ...entornoNavegador(), ...entorno }
  let rutas: string[] = []
  let firma = ''
  let cancelarEspera: (() => void) | null = null
  let detener: AbortController | null = null
  let corriendo = false
  let pendiente = false
  let destruida = false
  let avisoAhorro = false
  // Respaldos si localStorage no está disponible.
  let ultimaEnMemoria: { t: number; firma: string } | null = null
  let problemasEnMemoria = 0
  let atencionAvisada = leerProblemas() >= PASADAS_CON_PROBLEMAS_PARA_AVISAR

  const oculta = () => e.documento?.visibilityState === 'hidden'

  const alCambiarVisibilidad = () => {
    if (oculta()) {
      cancelarEspera?.()
      cancelarEspera = null
      detener?.abort()
    } else {
      programar()
    }
  }
  e.documento?.addEventListener('visibilitychange', alCambiarVisibilidad)

  function programar() {
    if (destruida || cancelarEspera || rutas.length === 0 || oculta()) return
    cancelarEspera = e.esperarReposo(() => {
      cancelarEspera = null
      void correr()
    }, ESPERA_REPOSO_MS)
  }

  async function correr() {
    if (destruida || oculta() || rutas.length === 0) return
    if (corriendo) {
      pendiente = true // se retoma cuando termine la actual
      return
    }
    if (e.ahorroDeDatos()) {
      if (!avisoAhorro) console.info(`${PREFIJO_LOG} Ahorro de datos activado: no se generan.`)
      avisoAhorro = true
      return
    }
    if (pasadaReciente(firma)) return

    const control = new AbortController()
    const firmaPasada = firma
    detener = control
    corriendo = true
    pendiente = false
    try {
      const resumen = await e.pasada(rutas, control.signal)
      if (resumen.completa) anotarPasada(firmaPasada)
      if (pasadaConProblemas(resumen)) guardarProblemas(leerProblemas() + 1)
      else if (resumen.completa) guardarProblemas(0)
    } catch (error) {
      console.warn(`${PREFIJO_LOG} Falló la pasada automática.`, error)
      guardarProblemas(leerProblemas() + 1)
    } finally {
      corriendo = false
      if (detener === control) detener = null
      if (pendiente) {
        pendiente = false
        programar()
      }
    }
  }

  function pasadaReciente(firmaActual: string): boolean {
    const ultima = leerUltima() ?? ultimaEnMemoria
    if (!ultima || ultima.firma !== firmaActual) return false
    const transcurrido = e.ahora() - ultima.t
    return transcurrido >= 0 && transcurrido < INTERVALO_PASADAS_MS
  }

  function leerUltima(): { t: number; firma: string } | null {
    try {
      const texto = e.almacen()?.getItem(CLAVE_ULTIMA_PASADA)
      if (!texto) return null
      const valor: unknown = JSON.parse(texto)
      if (typeof valor !== 'object' || valor === null) return null
      const { t, firma: f } = valor as { t?: unknown; firma?: unknown }
      return typeof t === 'number' && typeof f === 'string' ? { t, firma: f } : null
    } catch {
      return null
    }
  }

  function anotarPasada(firmaPasada: string) {
    ultimaEnMemoria = { t: e.ahora(), firma: firmaPasada }
    try {
      e.almacen()?.setItem(CLAVE_ULTIMA_PASADA, JSON.stringify(ultimaEnMemoria))
    } catch {
      // Sin localStorage: queda el respaldo en memoria.
    }
  }

  // Pasadas seguidas con problemas: lo guardado, o el respaldo en memoria.
  function leerProblemas(): number {
    try {
      const n = Number(e.almacen()?.getItem(CLAVE_PASADAS_CON_PROBLEMAS) ?? NaN)
      if (Number.isInteger(n) && n >= 0) return n
    } catch {
      // Sin localStorage: se usa el respaldo en memoria.
    }
    return problemasEnMemoria
  }

  function guardarProblemas(n: number) {
    problemasEnMemoria = n
    try {
      e.almacen()?.setItem(CLAVE_PASADAS_CON_PROBLEMAS, String(n))
    } catch {
      // Sin localStorage: queda el respaldo en memoria.
    }
    const necesita = n >= PASADAS_CON_PROBLEMAS_PARA_AVISAR
    if (necesita === atencionAvisada) return
    atencionAvisada = necesita
    if (!destruida) opciones.alCambiarAtencion?.(necesita)
  }

  return {
    actualizar(nuevas, nuevaFirma) {
      rutas = nuevas
      firma = nuevaFirma
      programar()
    },
    necesitaAtencion: () => leerProblemas() >= PASADAS_CON_PROBLEMAS_PARA_AVISAR,
    destruir() {
      destruida = true
      cancelarEspera?.()
      cancelarEspera = null
      detener?.abort()
      e.documento?.removeEventListener('visibilitychange', alCambiarVisibilidad)
    },
  }
}

// Llama a `fn` pasados `ms` y cuando el navegador esté ocioso
// (requestIdleCallback, o directo donde no existe). Devuelve cómo cancelarlo.
export function esperarReposo(fn: () => void, ms: number): () => void {
  let ocioso: number | null = null
  const reloj = setTimeout(() => {
    if (typeof requestIdleCallback === 'function') {
      ocioso = requestIdleCallback(
        () => {
          ocioso = null
          fn()
        },
        { timeout: ms },
      )
    } else {
      fn()
    }
  }, ms)
  return () => {
    clearTimeout(reloj)
    if (ocioso !== null && typeof cancelIdleCallback === 'function') cancelIdleCallback(ocioso)
  }
}

function entornoNavegador(): EntornoAutomatico {
  return {
    pasada: (rutas, detener) => generarMiniaturasFaltantes(rutas, { detener }),
    documento: typeof document === 'undefined' ? null : document,
    ahorroDeDatos: () => {
      if (typeof navigator === 'undefined') return false
      const { connection } = navigator as Navigator & { connection?: { saveData?: boolean } }
      return connection?.saveData === true
    },
    almacen: () => {
      try {
        return typeof localStorage === 'undefined' ? null : localStorage
      } catch {
        return null
      }
    },
    ahora: Date.now,
    esperarReposo,
  }
}
