// Borrador del formulario del checkout en sessionStorage: si la clienta
// recarga, vuelve al carrito o se va a confirmar el email, no tiene que
// escribir todo de nuevo. Solo dura la pestaña (no queda en el dispositivo).

export interface BorradorCheckout {
  nombre: string
  telefono: string
  email: string
  entrega: 'coordinar' | 'envio'
  direccion: string
  localidad: string
  cp: string
  provincia: string
  notas: string
}

const CLAVE = 'pecora-checkout-borrador'

export function leerBorrador(almacen: Storage | null = sesion()): Partial<BorradorCheckout> {
  try {
    const crudo = almacen?.getItem(CLAVE)
    if (!crudo) return {}
    const datos = JSON.parse(crudo) as Record<string, unknown>
    const limpio: Partial<BorradorCheckout> = {}
    for (const [k, v] of Object.entries(datos)) {
      if (typeof v === 'string') (limpio as Record<string, string>)[k] = v
    }
    if (limpio.entrega !== 'envio' && limpio.entrega !== 'coordinar') delete limpio.entrega
    return limpio
  } catch {
    return {}
  }
}

export function guardarBorrador(b: BorradorCheckout, almacen: Storage | null = sesion()): void {
  try {
    almacen?.setItem(CLAVE, JSON.stringify(b))
  } catch {
    // Modo privado o sin espacio: el borrador es una comodidad, no hace falta.
  }
}

export function borrarBorrador(almacen: Storage | null = sesion()): void {
  try {
    almacen?.removeItem(CLAVE)
  } catch {
    /* idem */
  }
}

function sesion(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

// Teléfono de contacto: tiene que alcanzar para escribirle por WhatsApp (con
// código de área). Devuelve el mensaje de error o null.
export function errorTelefono(telefono: string): string | null {
  const digitos = telefono.replace(/\D/g, '')
  if (digitos.length < 10) {
    return 'Revisá el teléfono: escribilo con código de área, por ejemplo 351 555 1234.'
  }
  if (digitos.length > 15) return 'Revisá el teléfono: tiene demasiados números.'
  return null
}

// Email de quien compra sin cuenta: ahí le llega el comprobante. Devuelve el
// mensaje de error o null (misma regla que la base, en crear_pedido).
export function errorEmail(email: string): string | null {
  const limpio = email.trim()
  if (!limpio) return 'Escribí tu email: ahí te mandamos el comprobante del pedido.'
  if (limpio.length > 254 || !/^[^@\s,<>]+@[^@\s,<>]+\.[^@\s,<>]+$/.test(limpio)) {
    return 'Revisá el email: parece que está mal escrito.'
  }
  return null
}
