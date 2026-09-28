import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import {
  cargaInicialRestaurable,
  claveDe,
  debeRestaurar,
  escribirPosiciones,
  guardarPosicion,
  leerPosiciones,
} from '../lib/scrollPositions'

// Manejo del scroll en la tienda pública (<BrowserRouter> no lo hace solo):
//  - Navegación nueva (PUSH/REPLACE) a OTRA ruta -> arriba de todo. Un cambio
//    de query en la misma ruta (chips de categoría, búsqueda) no mueve el scroll.
//  - Atrás/adelante (POP) -> restaura la posición guardada para esa entrada del
//    historial, reintentando mientras la página todavía no alcanza esa altura
//    (ej. el muestrario terminando de cargar).
// Las posiciones se guardan por entrada del historial (location.key) en memoria
// y se copian a sessionStorage para sobrevivir a una recarga.
// La lógica pura (claves, lectura/escritura con tope, decisión de restaurar)
// vive en lib/scrollPositions y tiene tests.

const TIEMPO_MAX_RESTAURAR = 2500

const posiciones = new Map<string, number>()
let cargadas = false

// Se pasa como función para que el acceso a sessionStorage (que puede tirar
// error si está bloqueado) ocurra dentro del try de leer/escribirPosiciones.
const almacen = () => sessionStorage

function cargarPosiciones() {
  if (cargadas) return
  cargadas = true
  leerPosiciones(almacen, posiciones)
}

function persistirPosiciones() {
  escribirPosiciones(almacen, posiciones)
}

function navegacionActual() {
  return performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
}

export default function ScrollManager() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const clave = claveDe(location.key, location.pathname, location.search)

  const claveRef = useRef(clave)
  const rutaAnteriorRef = useRef<string | null>(null)
  // Pasa a true con la primera navegación dentro de la app. Mientras sea
  // false seguimos en la carga inicial del documento (también cuando
  // StrictMode ejecuta dos veces los efectos al montar).
  const claveInicialRef = useRef(clave)
  const navegoRef = useRef(false)

  // El navegador no debe restaurar por su cuenta: lo hacemos acá, cuando la
  // página ya tiene contenido.
  useEffect(() => {
    cargarPosiciones()
    const h = window.history
    const previo = h.scrollRestoration
    h.scrollRestoration = 'manual'

    let frame = 0
    let timerPersistir = 0
    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        guardarPosicion(posiciones, claveRef.current, window.scrollY)
        window.clearTimeout(timerPersistir)
        timerPersistir = window.setTimeout(persistirPosiciones, 250)
      })
    }
    const onPageHide = () => persistirPosiciones()

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', onPageHide)
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timerPersistir)
      persistirPosiciones()
      h.scrollRestoration = previo
    }
  }, [])

  useLayoutEffect(() => {
    cargarPosiciones()
    claveRef.current = clave
    if (clave !== claveInicialRef.current) navegoRef.current = true
    const esPrimeraCarga = !navegoRef.current
    const rutaAnterior = rutaAnteriorRef.current
    rutaAnteriorRef.current = location.pathname
    const cambioDeRuta = rutaAnterior !== null && rutaAnterior !== location.pathname

    if (navigationType !== 'POP') {
      if (cambioDeRuta) window.scrollTo(0, 0)
      return
    }

    const guardada = posiciones.get(clave)
    const restaurable = () => cargaInicialRestaurable(navegacionActual)
    if (!debeRestaurar(guardada, esPrimeraCarga, restaurable)) {
      if (cambioDeRuta) window.scrollTo(0, 0)
      return
    }

    // Restauración con reintentos: si la página todavía es más corta que la
    // posición guardada, se vuelve a intentar cada vez que crece el contenido,
    // hasta alcanzarla o agotar el tiempo. Cualquier gesto de la usuaria la
    // cancela para no "pelear" con su scroll.
    const objetivo = guardada
    const raiz = document.getElementById('root') ?? document.body
    let terminado = false
    let observer: ResizeObserver | null = null
    let timer = 0

    const alcanzable = () =>
      document.documentElement.scrollHeight - window.innerHeight >= objetivo - 1

    const terminar = () => {
      if (terminado) return
      terminado = true
      observer?.disconnect()
      window.clearTimeout(timer)
      window.removeEventListener('wheel', terminar)
      window.removeEventListener('touchstart', terminar)
      window.removeEventListener('keydown', terminar)
    }

    const intentar = () => {
      if (terminado) return
      window.scrollTo(0, objetivo)
      if (alcanzable()) terminar()
    }

    intentar()
    if (!terminado) {
      window.addEventListener('wheel', terminar, { passive: true })
      window.addEventListener('touchstart', terminar, { passive: true })
      window.addEventListener('keydown', terminar)
      timer = window.setTimeout(terminar, TIEMPO_MAX_RESTAURAR)
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(intentar)
        observer.observe(raiz)
      }
    }
    return terminar
  }, [clave, location.pathname, navigationType])

  return null
}
