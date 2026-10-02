// Avisos del panel cuando entra un pedido: un sonido corto y, si la pestaña
// está en segundo plano, una notificación del sistema (la del celular o la
// compu). Cada dispositivo elige si los quiere (se guarda en localStorage).

const CLAVE = 'pecora-panel-avisos'

export interface PreferenciaAvisos {
  sonido: boolean
  sistema: boolean
}

export function leerPreferencia(): PreferenciaAvisos {
  try {
    const raw = localStorage.getItem(CLAVE)
    const v = raw ? (JSON.parse(raw) as Partial<PreferenciaAvisos>) : {}
    return { sonido: v.sonido !== false, sistema: v.sistema === true }
  } catch {
    return { sonido: true, sistema: false }
  }
}

export function guardarPreferencia(p: PreferenciaAvisos): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(p))
  } catch {
    /* sin persistencia: vale para esta sesión */
  }
}

export function notificacionesDisponibles(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

/** Pide permiso para las notificaciones del sistema. true si quedó concedido. */
export async function pedirPermiso(): Promise<boolean> {
  if (!notificacionesDisponibles()) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    return (await Notification.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

let contexto: AudioContext | null = null

/** Dos notas cortas (tipo "ding-dong"), sin archivos de audio. */
export function sonarAviso(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    contexto ??= new Ctx()
    const ctx = contexto
    if (ctx.state === 'suspended') void ctx.resume()
    const ahora = ctx.currentTime
    for (const [i, frecuencia] of [880, 660].entries()) {
      const osc = ctx.createOscillator()
      const vol = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = frecuencia
      const t = ahora + i * 0.18
      vol.gain.setValueAtTime(0.0001, t)
      vol.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
      vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
      osc.connect(vol).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.4)
    }
  } catch {
    /* sin audio: queda el aviso en pantalla */
  }
}

/**
 * Notificación del sistema, solo si la pestaña no está a la vista (si está a
 * la vista ya aparece el aviso del panel) y hay permiso.
 */
export function notificarSistema(titulo: string, cuerpo: string, alTocar: () => void): void {
  if (!notificacionesDisponibles() || Notification.permission !== 'granted') return
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return
  try {
    const n = new Notification(titulo, { body: cuerpo, icon: '/icon-192.png', tag: 'pecora-pedido' })
    n.onclick = () => {
      window.focus()
      alTocar()
      n.close()
    }
  } catch {
    // Algunos celulares solo permiten notificaciones desde un service worker.
  }
}
