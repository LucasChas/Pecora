import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

// CAPTCHA de la compra como invitada: widget de Cloudflare Turnstile. En casi
// todos los casos no se ve (appearance 'interaction-only'): Cloudflare decide
// en segundo plano y solo muestra un recuadro si tiene dudas. El token que
// entrega es de un solo uso y vence a los 5 minutos; lo verifica la Edge
// Function crear-pedido-invitada. Después de cada intento hay que pedir uno
// nuevo con reset().

interface Turnstile {
  render(el: HTMLElement, opciones: Record<string, unknown>): string
  reset(id?: string): void
  remove(id: string): void
}

declare global {
  interface Window {
    turnstile?: Turnstile
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

// El script se carga una sola vez, solo cuando se muestra el widget.
let cargando: Promise<Turnstile> | null = null
function cargarTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!cargando) {
    cargando = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = SCRIPT
      s.async = true
      s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')))
      s.onerror = () => {
        cargando = null
        s.remove()
        reject(new Error('turnstile'))
      }
      document.head.appendChild(s)
    })
  }
  return cargando
}

export interface CaptchaHandle {
  reset: () => void
}

interface Props {
  siteKey: string
  // Token nuevo, o null cuando vence o falla.
  onToken: (token: string | null) => void
  // No se pudo cargar o verificar (bloqueador, sin conexión).
  onError?: () => void
}

const Captcha = forwardRef<CaptchaHandle, Props>(function Captcha({ siteKey, onToken, onError }, ref) {
  const contenedor = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  // Callbacks en refs: el widget se crea una vez y siempre llama a la última.
  const alToken = useRef(onToken)
  const alError = useRef(onError)
  alToken.current = onToken
  alError.current = onError

  useImperativeHandle(ref, () => ({
    reset() {
      alToken.current(null)
      if (widget.current) window.turnstile?.reset(widget.current)
    },
  }))

  useEffect(() => {
    let cancelado = false
    cargarTurnstile()
      .then((t) => {
        if (cancelado || !contenedor.current) return
        widget.current = t.render(contenedor.current, {
          sitekey: siteKey,
          action: 'checkout',
          language: 'es',
          appearance: 'interaction-only',
          callback: (token: string) => alToken.current(token),
          'expired-callback': () => alToken.current(null),
          'error-callback': () => {
            alToken.current(null)
            alError.current?.()
          },
        })
      })
      .catch(() => {
        if (!cancelado) alError.current?.()
      })
    return () => {
      cancelado = true
      if (widget.current) window.turnstile?.remove(widget.current)
      widget.current = null
    }
  }, [siteKey])

  return <div ref={contenedor} className="captcha" />
})

export default Captcha
