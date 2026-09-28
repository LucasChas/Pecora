import { useLayoutEffect, useRef, useState } from 'react'

// Ancho real del contenedor (se actualiza al redimensionar) para dibujar los
// gráficos SVG a medida, sin escalar el texto.
export function useAncho<T extends HTMLElement>(inicial: number) {
  const ref = useRef<T>(null)
  const [ancho, setAncho] = useState(inicial)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const medir = () => {
      const w = Math.round(el.getBoundingClientRect().width)
      if (w > 0) setAncho(w)
    }
    medir()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, ancho] as const
}
