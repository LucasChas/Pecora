import { useEffect, useState } from 'react'

// Evento que Chrome/Edge/Android disparan cuando el sitio se puede instalar
// como app (manifest.webmanifest). No está en los tipos del DOM.
interface EventoInstalar extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// "Instalar Pecora": acceso directo en la pantalla de inicio del celular. Solo
// aparece si el navegador lo permite y todavía no está instalada. En iPhone
// (Safari no tiene este evento) se explica cómo hacerlo a mano.
export default function InstalarApp() {
  const [evento, setEvento] = useState<EventoInstalar | null>(null)
  const [ayudaIos, setAyudaIos] = useState(false)
  const [instalada, setInstalada] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches,
  )

  useEffect(() => {
    const alPoder = (e: Event) => {
      e.preventDefault()
      setEvento(e as EventoInstalar)
    }
    const alInstalar = () => {
      setInstalada(true)
      setEvento(null)
    }
    window.addEventListener('beforeinstallprompt', alPoder)
    window.addEventListener('appinstalled', alInstalar)
    return () => {
      window.removeEventListener('beforeinstallprompt', alPoder)
      window.removeEventListener('appinstalled', alInstalar)
    }
  }, [])

  const esIos =
    typeof navigator !== 'undefined' &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !(navigator as Navigator & { standalone?: boolean }).standalone

  if (instalada || (!evento && !esIos)) return null

  async function instalar() {
    if (!evento) {
      setAyudaIos((v) => !v)
      return
    }
    await evento.prompt()
    const { outcome } = await evento.userChoice
    if (outcome === 'accepted') setInstalada(true)
    setEvento(null)
  }

  return (
    <div className="instalar-app">
      <button type="button" className="site-footer-link instalar-app-btn" onClick={() => void instalar()}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <rect x="6" y="2" width="12" height="20" rx="3" />
          <path d="M12 7v7m-3-3 3 3 3-3" />
        </svg>
        Instalar Pecora en el celular
      </button>
      {ayudaIos && (
        <p className="instalar-app-ayuda">
          En iPhone: tocá <strong>Compartir</strong> (el cuadrado con la flecha) y después{' '}
          <strong>Agregar a inicio</strong>.
        </p>
      )}
    </div>
  )
}
