import { supabase } from './supabaseClient'
import { BUCKET_PRODUCTOS, CARPETA_MINIATURAS, miniaturaDe, rutaMiniaturaDe } from './images'

// ============================================================================
// Registro de miniaturas DISPONIBLES: qué archivos hay de verdad en thumbs/
// del bucket "productos". La grilla, el carrito y el panel piden una
// miniatura solo si figura acá (nunca "a ver si existe"): así no sale un 400
// por cada foto vieja y ningún 400 queda cacheado (navegador/CDN) para una
// miniatura que se sube después.
//
// - Un solo listado de Storage (paginado) a la vez, compartido por todas las
//   <Miniatura> que lo pidan juntas.
// - Se guarda en memoria y en sessionStorage y se vuelve a listar pasado
//   TTL_REGISTRO_MS. Mientras tanto se usa lo último conocido: un dato viejo
//   es inofensivo (una miniatura nueva se ve como original hasta el próximo
//   listado y una borrada cae al original por el onError de Miniatura).
// - Si el listado falla (sin red, política de Storage) no se usa ninguna
//   miniatura: todo sigue con los originales, sin avisos a la clienta.
//
// El listado lo permite la política "productos storage lectura publica"
// (select en storage.objects para anon y authenticated, migración 0001).
// ============================================================================

export const TTL_REGISTRO_MS = 10 * 60_000
// Tras un listado fallido no se reintenta enseguida: si no, cada card que se
// monta dispararía otro pedido.
export const ESPERA_TRAS_FALLA_MS = 60_000
export const CLAVE_SESION = 'pecora-miniaturas-v1'
export const POR_PAGINA = 1000
// Hoy todas las fotos están en la raíz del bucket (thumbs/ es plana), pero si
// aparece una subcarpeta se recorre, con límites por las dudas.
const PROFUNDIDAD_MAX = 3
const PAGINAS_MAX = 100
const PREFIJO_LOG = '[Miniaturas]'

export type Disponibles = ReadonlySet<string>

export interface RegistroMiniaturas {
  // Lo último conocido (la misma referencia mientras no cambie), o null si
  // todavía no se pudo listar nunca.
  disponibles: () => Disponibles | null
  // Asegura un listado vigente y lo devuelve; `forzar` lista aunque siga
  // vigente. Nunca rechaza: si falla, devuelve lo último conocido (o null).
  cargar: (forzar?: boolean) => Promise<Disponibles | null>
  // Anota una miniatura recién subida (o que ya existía) para usarla ya.
  agregar: (ruta: string) => void
  // Aviso cada vez que cambia `disponibles` (para useSyncExternalStore).
  suscribir: (oyente: () => void) => () => void
}

type AlmacenTexto = Pick<Storage, 'getItem' | 'setItem'>

export interface OpcionesRegistro {
  ahora?: () => number
  // sessionStorage por defecto; null si no hay (modo privado, bloqueado).
  almacen?: () => AlmacenTexto | null
  ttl?: number
}

export function crearRegistroMiniaturas(opciones: OpcionesRegistro = {}): RegistroMiniaturas {
  const ahora = opciones.ahora ?? Date.now
  const almacen = opciones.almacen ?? sessionStorageSeguro
  const ttl = opciones.ttl ?? TTL_REGISTRO_MS

  let rutas: Disponibles | null = null
  let vence = 0
  let reintentarDesde = 0
  let enVuelo: Promise<Disponibles | null> | null = null
  // Anotadas en esta página: se suman a cada listado nuevo (uno que arrancó
  // antes de la subida no las trae y no hay que perderlas).
  const agregadas = new Set<string>()
  const oyentes = new Set<() => void>()

  hidratar()

  function publicar(nuevas: Set<string>) {
    if (rutas && mismas(rutas, nuevas)) return
    rutas = nuevas
    oyentes.forEach((oyente) => oyente())
  }

  function hidratar() {
    try {
      const texto = almacen()?.getItem(CLAVE_SESION)
      if (!texto) return
      const guardado: unknown = JSON.parse(texto)
      if (!esGuardado(guardado)) return
      rutas = new Set(guardado.rutas)
      // Un reloj que se movió no debería estirar la vigencia más allá del TTL.
      vence = Math.min(guardado.vence, ahora() + ttl)
    } catch {
      // sessionStorage inaccesible o dato corrupto: se lista de cero.
    }
  }

  function persistir() {
    if (!rutas) return
    try {
      almacen()?.setItem(CLAVE_SESION, JSON.stringify({ vence, rutas: Array.from(rutas) }))
    } catch {
      // Sin espacio o bloqueado: queda solo en memoria.
    }
  }

  function cargar(forzar = false): Promise<Disponibles | null> {
    if (enVuelo) return enVuelo
    const t = ahora()
    if (!forzar && rutas && t < vence) return Promise.resolve(rutas)
    if (!forzar && t < reintentarDesde) return Promise.resolve(rutas)

    const pedido = listarMiniaturas().then(
      (listadas) => {
        agregadas.forEach((ruta) => listadas.add(ruta))
        vence = ahora() + ttl
        publicar(listadas)
        persistir()
        return rutas
      },
      (error: unknown) => {
        reintentarDesde = ahora() + ESPERA_TRAS_FALLA_MS
        console.warn(`${PREFIJO_LOG} No se pudo leer el listado; se muestran los originales.`, error)
        return rutas
      },
    )
    enVuelo = pedido
    void pedido.finally(() => {
      if (enVuelo === pedido) enVuelo = null
    })
    return pedido
  }

  function agregar(ruta: string) {
    agregadas.add(ruta)
    if (rutas?.has(ruta)) return
    publicar(new Set(rutas ?? []).add(ruta))
    persistir()
  }

  function suscribir(oyente: () => void) {
    oyentes.add(oyente)
    return () => {
      oyentes.delete(oyente)
    }
  }

  return { disponibles: () => rutas, cargar, agregar, suscribir }
}

// Registro compartido por toda la app (catálogo, carrito y panel).
export const registroMiniaturas = crearRegistroMiniaturas()

// Qué src mostrar en una <Miniatura> (ver components/common/Miniatura):
// - la miniatura, solo si el registro dice que existe;
// - el original si no figura, si la miniatura ya falló (`fallida`) o si el
//   original ya terminó de cargar (`originalCargado`): una imagen que ya está
//   en pantalla no se reemplaza (sin parpadeo ni doble descarga).
export function elegirFuente(
  src: string,
  disponibles: Disponibles | null,
  estado: { fallida: string | null; originalCargado: string | null },
): string {
  if (!disponibles || estado.originalCargado === src) return src
  const ruta = rutaMiniaturaDe(src)
  if (ruta === null || !disponibles.has(ruta)) return src
  const miniatura = miniaturaDe(src)
  return miniatura === estado.fallida ? src : miniatura
}

// Todas las rutas de thumbs/ (sin codificar, ej. "thumbs/3f2a….jpg"),
// página por página. Rechaza si Storage devuelve un error.
async function listarMiniaturas(): Promise<Set<string>> {
  const encontradas = new Set<string>()
  const carpetas = [{ ruta: CARPETA_MINIATURAS, nivel: 0 }]
  for (let carpeta = carpetas.shift(); carpeta; carpeta = carpetas.shift()) {
    for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
      const { data, error } = await supabase.storage.from(BUCKET_PRODUCTOS).list(carpeta.ruta, {
        limit: POR_PAGINA,
        offset: pagina * POR_PAGINA,
        sortBy: { column: 'name', order: 'asc' },
      })
      if (error) throw error
      const entradas = data ?? []
      for (const entrada of entradas) {
        const ruta = `${carpeta.ruta}/${entrada.name}`
        // Las carpetas vienen sin id ni metadata.
        if (entrada.id != null || entrada.metadata != null) encontradas.add(ruta)
        else if (carpeta.nivel < PROFUNDIDAD_MAX) carpetas.push({ ruta, nivel: carpeta.nivel + 1 })
      }
      if (entradas.length < POR_PAGINA) break
    }
  }
  return encontradas
}

function sessionStorageSeguro(): AlmacenTexto | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

function esGuardado(valor: unknown): valor is { vence: number; rutas: string[] } {
  if (typeof valor !== 'object' || valor === null) return false
  const { vence, rutas } = valor as { vence?: unknown; rutas?: unknown }
  return (
    typeof vence === 'number' &&
    Number.isFinite(vence) &&
    Array.isArray(rutas) &&
    rutas.every((r) => typeof r === 'string')
  )
}

function mismas(a: Disponibles, b: Disponibles): boolean {
  if (a.size !== b.size) return false
  for (const ruta of b) if (!a.has(ruta)) return false
  return true
}
