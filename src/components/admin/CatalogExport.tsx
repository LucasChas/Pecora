import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react'
import type { Categoria, ProductoConCategoria } from '../../types'
import {
  COLUMNAS,
  LADO_MINIATURA,
  PREFIJO_LOG,
  agruparPorCategoria,
  armarBandas,
  conTiempoMax,
  correrTareas,
  mesAnio,
  mesAnioCorto,
  paginar,
  type Banda,
  type Fragmento,
  type MedidaBanda,
  type MedidaHoja,
} from '../../lib/catalogExport'
import { catalogoHost } from '../../lib/config'
import { IMG_PLACEHOLDER, portadaDe } from '../../lib/images'
import PriceListPage from './PriceListPage'
import PriceListBand from './PriceListBand'
import PriceListMobile from './PriceListMobile'
import '../../styles/catalog-export.css'

interface Props {
  // Datos que ya trae el panel (useProducts / useCategories): no se consulta de nuevo.
  productos: ProductoConCategoria[]
  categorias: Categoria[]
  loading: boolean
  error: string | null
  onVolver: () => void
}

// @page no se puede acotar a una clase: se inyecta solo mientras esta vista
// está montada, así no cambia cómo se imprime el resto de la app.
const PAGINA_A4 = '@page { size: A4; margin: 0; }'

// Tipografías de la plantilla. Se piden explícitamente antes de medir: si no,
// document.fonts.ready puede resolverse antes de que el navegador las necesite.
const FUENTES = [
  '500 22px Fraunces',
  '600 17px Fraunces',
  '600 15px Fraunces',
  '400 11px Inter',
  '500 10.5px Inter',
  '600 9.5px Inter',
]

// 210 mm en px CSS (96 dpi) + el padding lateral de la vista previa.
const ANCHO_VISTA_PX = (210 * 96) / 25.4 + 24

// Margen de seguridad (px) para que el redondeo de subpíxeles no desborde la hoja.
const MARGEN_SEGURIDAD = 2

// Fotos: se bajan de a pocas, con tope de tiempo cada una, y se achican a
// miniaturas antes de dibujar las hojas. Bajar y decodificar a la vez todas
// las originales (hasta 1400 px, puede haber cientos) deja sin memoria a un celular.
const FOTOS_A_LA_VEZ = 4
const TOPE_FOTO_MS = 15_000

// Tope para esperar las tipografías y que las miniaturas terminen de
// dibujarse: pasado ese tiempo se sigue igual, con aviso en consola.
const TOPE_ESPERA_MS = 10_000

// Pantalla angosta (celular): la vista previa por defecto es la lista legible
// y se puede pasar a las hojas A4. Es el único lugar donde vive este corte:
// el CSS del celular cuelga de la clase .ce-angosta que se pone acá.
const CONSULTA_ANGOSTA = '(max-width: 767.98px)'

const PISTA_PDF = 'Al imprimir, elegí "Guardar como PDF".'

// Miniaturas listas: portada original -> miniatura local (blob:).
type Fotos = ReadonlyMap<string, string>

// Qué se ve en pantalla en el celular. No cambia lo que se imprime.
type Vista = 'lista' | 'hojas'

// Vista de impresión de la lista de precios (botón "Exportar catálogo").
// Arma las hojas A4 con los productos del muestrario y las imprime con
// window.print(): en el diálogo se elige "Guardar como PDF".
//
// La paginación se calcula midiendo el DOM real: primero se dibujan fuera de
// pantalla las bandas y dos hojas vacías (primera / siguientes), se toman las
// alturas y recién ahí se reparten las bandas en hojas (ver lib/catalogExport).
//
// Las fotos no van en su tamaño original: se preparan miniaturas (ver
// useMiniaturas) y la descarga se habilita cuando están todas resueltas.
//
// En el celular las hojas achicadas no se leen: la vista previa por defecto es
// una lista (PriceListMobile) con el mismo contenido y las mismas miniaturas,
// y un selector "Lista | Hojas A4". Las hojas se dibujan igual (ocultas solo
// en pantalla): así la medición, la espera de fotos y la impresión no dependen
// de lo que se esté mirando. Al imprimir siempre salen las hojas A4.
export default function CatalogExport({ productos, categorias, loading, error, onVolver }: Props) {
  const [{ mes, mesCorto }] = useState(() => {
    const hoy = new Date()
    return { mes: mesAnio(hoy), mesCorto: mesAnioCorto(hoy) }
  })
  const sitio = catalogoHost()
  const angosta = usePantallaAngosta()
  const [vista, setVista] = useState<Vista>('lista')

  const medicionRef = useRef<HTMLDivElement>(null)
  const hojasRef = useRef<HTMLDivElement>(null)

  const [fuentesListas, setFuentesListas] = useState(false)
  // Hojas calculadas para un juego de bandas puntual: si los datos cambian
  // (Realtime), las bandas son otras y se vuelve a medir.
  const [plan, setPlan] = useState<{ bandas: Banda[]; hojas: Fragmento[][] } | null>(null)
  // Hojas y miniaturas para las que ya se dibujaron todas las fotos.
  const [dibujadas, setDibujadas] = useState<{ hojas: Fragmento[][]; fotos: Fotos } | null>(null)
  const [escala, setEscala] = useState(1)

  // Los grupos alimentan la lista del celular y, armados en bandas, las hojas:
  // mismo agrupamiento y mismo orden en los dos.
  const grupos = useMemo(
    () => agruparPorCategoria(productos, categorias),
    [productos, categorias],
  )
  const bandas = useMemo(() => armarBandas(grupos), [grupos])
  const miniaturas = useMiniaturas(productos)
  const fotos = miniaturas.fotos
  const hojas = plan && plan.bandas === bandas ? plan.hojas : null
  const medir = fuentesListas && !loading && !error && bandas.length > 0 && hojas === null
  // Listo = tipografías cargadas (sin eso no se mide), hojas medidas,
  // miniaturas resueltas (bien o con cuadrado vacío) y ya dibujadas.
  const listo =
    hojas !== null && fotos !== null && dibujadas?.hojas === hojas && dibujadas.fotos === fotos
  // En el celular el botón comparte la barra con el título: texto más corto.
  const textoEspera =
    fotos === null && miniaturas.total > 0
      ? `${angosta ? 'Preparando…' : 'Preparando fotos…'} ${miniaturas.hechas}/${miniaturas.total}`
      : 'Preparando…'

  // Título de la pestaña = nombre por defecto del PDF. Se restaura al salir.
  useEffect(() => {
    const tituloAnterior = document.title
    document.title = `Pecora - Lista de precios - ${mes}`
    document.documentElement.classList.add('ce-activo')
    window.scrollTo(0, 0)
    return () => {
      document.title = tituloAnterior
      document.documentElement.classList.remove('ce-activo')
    }
  }, [mes])

  // Espera las tipografías: cambian las alturas de títulos, nombres y precios.
  // Con tope: si la red se traba, se mide igual con las que haya.
  useEffect(() => {
    const cancelar = new AbortController()
    conTiempoMax(cargarFuentes, TOPE_ESPERA_MS, cancelar.signal).then((r) => {
      if (cancelar.signal.aborted) return
      if (!r.ok) {
        console.warn(`${PREFIJO_LOG} Tipografías sin terminar de cargar (${r.motivo}); se sigue igual.`)
      }
      setFuentesListas(true)
    })
    return () => cancelar.abort()
  }, [])

  // Vista previa: achica las hojas para que entren a lo ancho en el celular.
  useEffect(() => {
    const ajustar = () =>
      setEscala(Math.min(1, document.documentElement.clientWidth / ANCHO_VISTA_PX))
    ajustar()
    window.addEventListener('resize', ajustar)
    return () => window.removeEventListener('resize', ajustar)
  }, [])

  // Medición (antes de pintar): alturas reales -> hojas.
  useLayoutEffect(() => {
    const raiz = medicionRef.current
    if (!medir || !raiz) return
    setPlan({
      bandas,
      hojas: paginar(medirBandas(raiz), medirHoja(raiz, 'primera'), medirHoja(raiz, 'resto')),
    })
  }, [medir, bandas])

  // Con las miniaturas ya en las hojas, espera a que se dibujen (son locales:
  // es casi inmediato) y habilita la descarga. Con tope: una foto trabada no
  // deja el botón en "Preparando…".
  useEffect(() => {
    const raiz = hojasRef.current
    if (!hojas || !fotos || !raiz) return
    const cancelar = new AbortController()
    const dibujar = (signal: AbortSignal) => esperarFotos(raiz, signal)
    conTiempoMax(dibujar, TOPE_ESPERA_MS, cancelar.signal).then((r) => {
      if (cancelar.signal.aborted) return
      if (!r.ok) {
        console.warn(
          `${PREFIJO_LOG} Fotos sin terminar de dibujarse (${r.motivo}); se habilita la descarga igual.`,
        )
      }
      setDibujadas({ hojas, fotos })
    })
    return () => cancelar.abort()
  }, [hojas, fotos])

  const cantidadHojas = hojas?.length ?? 0
  const hayContenido = !error && !loading && bandas.length > 0
  // La lista solo existe en pantalla angosta; en escritorio siguen las hojas.
  const conLista = angosta && vista === 'lista' && hayContenido

  // Segundo renglón de la barra. En el celular la pista del PDF va debajo,
  // junto al selector de vista, para que el renglón entre en una línea.
  const cantidadProductos = contar(productos.length, 'producto', 'productos')
  const resumen = hojas ? `${cantidadProductos} · ${contar(cantidadHojas, 'hoja', 'hojas')}` : null
  const sinResumen = 'Se arma con los productos del muestrario.'
  const detalle = angosta
    ? (resumen ?? (hayContenido ? `${cantidadProductos} · armando hojas…` : sinResumen))
    : resumen
      ? `${resumen} · ${PISTA_PDF}`
      : sinResumen

  const clases = ['catalog-export', angosta && 'ce-angosta', conLista && 'ce-vista-lista']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={clases}>
      <style>{PAGINA_A4}</style>

      <div className="ce-toolbar">
        {angosta ? (
          <button
            type="button"
            className="ce-btn ce-btn--ghost ce-btn--icono"
            onClick={onVolver}
            aria-label="Volver al panel"
            title="Volver al panel"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
              <path
                d="M19 12H5M11 6l-6 6 6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : (
          <button type="button" className="ce-btn ce-btn--ghost" onClick={onVolver}>
            Volver al panel
          </button>
        )}
        <div className="ce-toolbar-info">
          <strong>Lista de precios · {angosta ? mesCorto : mes}</strong>
          <span>{detalle}</span>
        </div>
        <button
          type="button"
          className="ce-btn ce-btn--primary"
          disabled={!listo}
          onClick={() => window.print()}
        >
          {listo ? 'Descargar PDF' : textoEspera}
        </button>
      </div>

      {/* Celular: qué se mira en pantalla. No cambia lo que se imprime. */}
      {angosta && hayContenido && (
        <div className="ce-subbar">
          <div className="ce-vistas" role="group" aria-label="Vista previa">
            <button
              type="button"
              className="ce-vista"
              aria-pressed={vista === 'lista'}
              onClick={() => setVista('lista')}
            >
              Lista
            </button>
            <button
              type="button"
              className="ce-vista"
              aria-pressed={vista === 'hojas'}
              onClick={() => setVista('hojas')}
            >
              Hojas A4
            </button>
          </div>
          <p className="ce-pista">{PISTA_PDF}</p>
        </div>
      )}

      {error ? (
        <div className="empty">
          No pudimos cargar el catálogo.
          <br />
          {error}
        </div>
      ) : loading ? (
        <div className="empty">Cargando catálogo…</div>
      ) : bandas.length === 0 ? (
        <div className="empty">
          Todavía no hay productos cargados.
          <br />
          Cuando cargues productos, vas a poder exportar la lista de precios.
        </div>
      ) : (
        <>
          {/* No espera a las hojas: se lee apenas hay datos; las fotos
              aparecen cuando están las miniaturas. */}
          {conLista && (
            <PriceListMobile
              grupos={grupos}
              mesAnio={mes}
              sitio={sitio}
              fotos={fotos ?? undefined}
            />
          )}
          {!hojas ? (
            !conLista && <div className="empty">Armando la lista de precios…</div>
          ) : (
            // Con la lista a la vista las hojas siguen montadas: se ocultan
            // solo en pantalla (.ce-vista-lista, ver CSS). El ref, la espera de
            // fotos y la impresión funcionan igual.
            <div
              className="ce-hojas"
              ref={hojasRef}
              style={{ '--ce-escala': escala } as CSSProperties}
            >
              {hojas.map((fragmentos, i) => (
                <PriceListPage
                  key={i}
                  primera={i === 0}
                  numero={i + 1}
                  total={cantidadHojas}
                  mesAnio={mes}
                  sitio={sitio}
                >
                  {fragmentos.map((f) => (
                    <PriceListBand
                      key={`${f.banda}-${f.filas?.[0] ?? 0}`}
                      bloques={bandas[f.banda]}
                      filas={f.filas}
                      continuacion={f.continuacion}
                      fotos={fotos ?? undefined}
                    />
                  ))}
                </PriceListPage>
              ))}
            </div>
          )}
        </>
      )}

      {/* Pasada de medición: fuera de pantalla y sin fotos (el cuadrado mide igual). */}
      {medir && (
        <div className="ce-medicion" ref={medicionRef} aria-hidden="true">
          <div data-hoja="primera">
            <PriceListPage primera numero={1} total={1} mesAnio={mes} sitio={sitio} />
          </div>
          <div data-hoja="resto">
            <PriceListPage primera={false} numero={2} total={2} mesAnio={mes} sitio={sitio} />
          </div>
          <PriceListPage primera={false} numero={0} total={0} mesAnio={mes} sitio={sitio} medir>
            {bandas.map((banda, i) => (
              <div key={i} data-banda={i}>
                <PriceListBand bloques={banda} />
              </div>
            ))}
          </PriceListPage>
        </div>
      )}
    </div>
  )
}

// ---- Pantalla --------------------------------------------------------------

// true mientras la ventana es angosta (ver CONSULTA_ANGOSTA). Se lee en el
// primer render (sin parpadeo de una vista a la otra) y se actualiza al girar
// el celular o cambiar el tamaño de la ventana.
function usePantallaAngosta(): boolean {
  return useSyncExternalStore(suscribirAngosta, esAngosta)
}

function esAngosta(): boolean {
  return window.matchMedia(CONSULTA_ANGOSTA).matches
}

function suscribirAngosta(avisar: () => void): () => void {
  const consulta = window.matchMedia(CONSULTA_ANGOSTA)
  consulta.addEventListener('change', avisar)
  return () => consulta.removeEventListener('change', avisar)
}

// "1 hoja" / "3 hojas".
function contar(cantidad: number, singular: string, plural: string): string {
  return `${cantidad} ${cantidad === 1 ? singular : plural}`
}

// ---- Fotos -----------------------------------------------------------------

interface EstadoMiniaturas {
  clave: string
  hechas: number
  total: number
  // null mientras se preparan. Las que fallaron no están: va el cuadrado vacío.
  fotos: Fotos | null
}

// Prepara las miniaturas de las portadas (ver crearMiniatura) de a
// FOTOS_A_LA_VEZ y con tope por foto. Una foto que falla o tarda demasiado
// queda con el cuadrado vacío (nunca la original, que es la que pesa) y se
// avisa en consola. Las miniaturas se liberan al salir o si cambian las fotos.
function useMiniaturas(productos: ProductoConCategoria[]): EstadoMiniaturas {
  const portadas = useMemo(() => portadasDe(productos), [productos])
  // Solo cuentan las URLs: un cambio de precio o stock (Realtime) no rehace las fotos.
  const clave = Array.from(portadas.keys()).join('\n')
  const [estado, setEstado] = useState<EstadoMiniaturas | null>(null)

  useEffect(() => {
    const urls = Array.from(portadas.keys())
    const cancelar = new AbortController()
    const creadas: string[] = []
    setEstado({ clave, hechas: 0, total: urls.length, fotos: null })

    correrTareas(
      urls,
      async (url, signal) => {
        const miniatura = await crearMiniatura(url, signal)
        // Venció el tope o se salió de la vista mientras se generaba: no se usa.
        if (signal.aborted) throw new Error('cancelada')
        const local = URL.createObjectURL(miniatura)
        creadas.push(local)
        return local
      },
      {
        concurrencia: FOTOS_A_LA_VEZ,
        tiempoMax: TOPE_FOTO_MS,
        cancelar: cancelar.signal,
        alAvanzar: (hechas) => {
          if (!cancelar.signal.aborted) setEstado((e) => (e ? { ...e, hechas } : e))
        },
      },
    ).then((resultados) => {
      if (cancelar.signal.aborted) return
      const listas = new Map<string, string>()
      resultados.forEach((r, i) => {
        if (r.ok) listas.set(urls[i], r.valor)
        else {
          const nombres = (portadas.get(urls[i]) ?? []).map((n) => `"${n}"`).join(', ')
          console.warn(
            `${PREFIJO_LOG} Sin foto para ${nombres} (${r.motivo}); va el cuadrado vacío.`,
            urls[i],
          )
        }
      })
      setEstado({ clave, hechas: urls.length, total: urls.length, fotos: listas })
    })

    return () => {
      cancelar.abort()
      creadas.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [clave]) // `portadas` es la del mismo render en que cambió `clave`

  if (estado && estado.clave === clave) return estado
  return { clave, hechas: 0, total: portadas.size, fotos: null }
}

// Portadas con foto real, sin repetir, con los productos que las usan (para
// los avisos). El placeholder no se baja: se dibuja como cuadrado vacío.
function portadasDe(productos: ProductoConCategoria[]): Map<string, string[]> {
  const portadas = new Map<string, string[]>()
  for (const p of productos) {
    const url = portadaDe(p)
    if (url !== IMG_PLACEHOLDER) portadas.set(url, [...(portadas.get(url) ?? []), p.nombre])
  }
  return portadas
}

// Baja una foto y la achica a un cuadrado de LADO_MINIATURA px (recorte
// centrado, como object-fit: cover) en JPEG. La foto grande se libera apenas
// se dibuja: en memoria queda solo la miniatura.
async function crearMiniatura(url: string, signal: AbortSignal): Promise<Blob> {
  const respuesta = await fetch(url, { mode: 'cors', signal })
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`)
  const foto = await createImageBitmap(await respuesta.blob())
  const lado = Math.min(foto.width, foto.height)
  const salida = Math.min(LADO_MINIATURA, lado) // una foto chica no se agranda
  const lienzo = document.createElement('canvas')
  lienzo.width = salida
  lienzo.height = salida
  try {
    const ctx = lienzo.getContext('2d')
    if (!ctx) throw new Error('canvas no disponible')
    // Fondo de la card: un PNG con transparencia no queda negro en JPEG.
    ctx.fillStyle = '#FFFBF2'
    ctx.fillRect(0, 0, salida, salida)
    ctx.imageSmoothingQuality = 'high'
    const x = (foto.width - lado) / 2
    const y = (foto.height - lado) / 2
    ctx.drawImage(foto, x, y, lado, lado, 0, 0, salida, salida)
  } finally {
    foto.close()
  }
  const miniatura = await new Promise<Blob | null>((resolve) =>
    lienzo.toBlob(resolve, 'image/jpeg', 0.85),
  )
  lienzo.width = 0 // suelta el buffer del canvas sin esperar al recolector
  if (!miniatura) throw new Error('no se pudo generar la miniatura')
  return miniatura
}

// Resuelve cuando todas las <img> de `raiz` terminaron de cargar (o fallaron).
// No depende del layout: `complete` y los eventos load/error no necesitan que
// la imagen se vea, así que funciona igual con las hojas ocultas en pantalla
// (display: none, vista "Lista" del celular). Las <img> no llevan
// loading="lazy": el navegador las carga aunque no se muestren.
function esperarFotos(raiz: HTMLElement, signal: AbortSignal): Promise<void> {
  const esperas = Array.from(raiz.querySelectorAll('img')).map((img) =>
    img.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const opciones = { once: true, signal }
          img.addEventListener('load', () => resolve(), opciones)
          img.addEventListener('error', () => resolve(), opciones)
        }),
  )
  return Promise.all(esperas).then(() => undefined)
}

// Pide cada tipografía de la plantilla y espera a que estén todas. Si una no
// carga se avisa y se sigue: se mide con la tipografía de reemplazo.
function cargarFuentes(): Promise<unknown> {
  const fuentes = document.fonts
  return Promise.all(
    FUENTES.map((fuente) =>
      fuentes.load(fuente).then(
        (caras) => {
          if (caras.length === 0) {
            console.warn(`${PREFIJO_LOG} La tipografía "${fuente}" no está disponible; va la de reemplazo.`)
          }
        },
        (error: unknown) => {
          console.warn(`${PREFIJO_LOG} No cargó la tipografía "${fuente}"; va la de reemplazo.`, error)
        },
      ),
    ),
  ).then(() => fuentes.ready)
}

// ---- Medición --------------------------------------------------------------

// Espacio útil del cuerpo de una hoja vacía y la separación entre bandas.
function medirHoja(raiz: HTMLElement, cual: 'primera' | 'resto'): MedidaHoja {
  const cuerpo = raiz.querySelector<HTMLElement>(`[data-hoja="${cual}"] .ce-main`)
  if (!cuerpo) return { capacidad: 0, separacion: 0 }
  const estilo = getComputedStyle(cuerpo)
  const alto =
    cuerpo.getBoundingClientRect().height -
    parseFloat(estilo.paddingTop) -
    parseFloat(estilo.paddingBottom)
  return {
    capacidad: alto - MARGEN_SEGURIDAD,
    separacion: parseFloat(estilo.rowGap) || 0,
  }
}

// Alto de cada banda y, en las categorías de varias filas, dónde empieza y
// termina cada fila de cards (para poder partirlas entre hojas).
function medirBandas(raiz: HTMLElement): MedidaBanda[] {
  return Array.from(raiz.querySelectorAll<HTMLElement>('[data-banda]')).map((banda) => {
    const alto = banda.getBoundingClientRect().height
    const grupos = banda.querySelectorAll<HTMLElement>('.ce-grp')
    const grilla = grupos.length === 1 ? grupos[0].querySelector<HTMLElement>('.ce-cards') : null
    const cards = grilla ? Array.from(grilla.querySelectorAll<HTMLElement>('.ce-card')) : []
    if (!grilla || cards.length <= COLUMNAS) return { alto }

    const origen = grilla.getBoundingClientRect().top
    const cabecera = origen - grupos[0].getBoundingClientRect().top
    const tramos: { arriba: number; abajo: number }[] = []
    cards.forEach((card, i) => {
      const caja = card.getBoundingClientRect()
      const fila = Math.floor(i / COLUMNAS)
      const arriba = caja.top - origen
      const abajo = caja.bottom - origen
      const tramo = tramos[fila]
      if (!tramo) tramos[fila] = { arriba, abajo }
      else {
        tramo.arriba = Math.min(tramo.arriba, arriba)
        tramo.abajo = Math.max(tramo.abajo, abajo)
      }
    })
    return { alto, filas: { cabecera, tramos } }
  })
}
