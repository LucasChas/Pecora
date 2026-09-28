import { useEffect, useState, type RefObject } from 'react'

// Tipografías de marca que usan las vistas de impresión. Se piden
// explícitamente: si no, document.fonts.ready puede resolverse antes de que el
// navegador las necesite.
const FUENTES = [
  '400 12px Inter',
  '600 12px Inter',
  '700 12px Inter',
  '500 20px Fraunces',
  '600 20px Fraunces',
]

// Tope para esperar tipografías e imágenes: pasado ese tiempo se habilita igual.
const TOPE_ESPERA_MS = 8_000

// Resuelve cuando cargaron las tipografías y todas las <img> de `raiz`
// (bien o con error: una imagen rota no traba la impresión).
function esperarRecursos(raiz: HTMLElement | null): Promise<void> {
  const fuentes = document.fonts
  const esperaFuentes = Promise.all(
    FUENTES.map((f) => fuentes.load(f).catch(() => [])),
  ).then(() => fuentes.ready)
  const esperaImagenes = Array.from(raiz?.querySelectorAll('img') ?? []).map((img) =>
    img.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true })
          img.addEventListener('error', () => resolve(), { once: true })
        }),
  )
  return Promise.all([esperaFuentes, ...esperaImagenes]).then(() => undefined)
}

// Mecánica común de las vistas de impresión montadas en un portal .op-portal
// (nota de entrega / etiqueta del panel y comprobante de la clienta). Mientras
// la vista está montada:
//   - <html> lleva la clase op-activo: al imprimir se oculta todo lo que no
//     sea el portal (ver order-print.css);
//   - document.title pasa a `titulo` (es el nombre por defecto del PDF);
//   - el resto de la página queda inerte (sin foco ni clics).
// Al desmontarse se restaura todo. Devuelve true cuando cargaron tipografías e
// imágenes del portal (o pasó el tope), para habilitar el botón "Imprimir".
export function useVistaImpresion(
  raizRef: RefObject<HTMLElement>,
  titulo: string,
  prefijoLog: string,
): boolean {
  const [listo, setListo] = useState(false)

  useEffect(() => {
    const html = document.documentElement
    const tituloAnterior = document.title
    document.title = titulo
    html.classList.add('op-activo')

    const inertes: Element[] = []
    for (const el of Array.from(document.body.children)) {
      if (el === raizRef.current || el.hasAttribute('inert')) continue
      el.setAttribute('inert', '')
      inertes.push(el)
    }
    raizRef.current?.focus()

    return () => {
      document.title = tituloAnterior
      html.classList.remove('op-activo')
      for (const el of inertes) el.removeAttribute('inert')
    }
  }, [titulo, raizRef])

  useEffect(() => {
    let activo = true
    let temporizador: number | undefined
    const tope = new Promise<'tope'>((resolve) => {
      temporizador = window.setTimeout(() => resolve('tope'), TOPE_ESPERA_MS)
    })
    Promise.race([esperarRecursos(raizRef.current), tope]).then((resultado) => {
      if (!activo) return
      if (resultado === 'tope') {
        console.warn(`${prefijoLog} Tipografías o imágenes sin terminar de cargar; se habilita igual.`)
      }
      setListo(true)
    })
    return () => {
      activo = false
      window.clearTimeout(temporizador)
    }
  }, [raizRef, prefijoLog])

  return listo
}
