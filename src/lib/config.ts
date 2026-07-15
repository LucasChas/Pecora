import type { ProductoConCategoria } from '../types'

// ============================================================================
// Configuración de contacto (WhatsApp + Instagram).
// Todo lo "de negocio" que puede cambiar vive acá y/o en variables de entorno,
// para no tener que tocar componentes. Pensado para escalar: si mañana sumás
// más canales de contacto, se agregan en este único lugar.
// ============================================================================

// Número de WhatsApp (formato internacional sin + ni espacios). Viene del .env.
const WHATSAPP_NUMBER = import.meta.env.VITE_WHATSAPP_NUMBER || '5490000000000'

// Usuario de Instagram (sin @). Viene del .env. Si queda vacío, no se muestra
// el botón de Instagram en la UI.
const INSTAGRAM_USER = import.meta.env.VITE_INSTAGRAM_USER || ''

// Mensajes prellenados de WhatsApp. Cambiá el texto acá si querés otro tono.
function mensajeWhatsApp(producto: ProductoConCategoria): string {
  const disponible = producto.stock > 0
  return disponible
    ? `Hola! Quería consultar por "${producto.nombre}" (Pecora) que vi en la web.`
    : `Hola! Quería consultar disponibilidad de "${producto.nombre}" (Pecora).`
}

// Link de WhatsApp (wa.me) con el mensaje ya cargado.
export function waLink(producto: ProductoConCategoria): string {
  const msg = mensajeWhatsApp(producto)
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`
}

// ¿Está configurado Instagram? (para mostrar u ocultar el botón)
export const instagramHabilitado = INSTAGRAM_USER !== ''

// Link de perfil de Instagram (para contacto general, ej. en el footer).
export function instagramPerfilLink(): string {
  return `https://instagram.com/${INSTAGRAM_USER}`
}

// Link de mensaje directo (DM) de Instagram. ig.me/m abre el chat con la marca,
// análogo a wa.me. Instagram no permite prellenar el texto, así que el mensaje
// lo escribe la clienta (a diferencia de WhatsApp).
export function instagramDmLink(): string {
  return `https://ig.me/m/${INSTAGRAM_USER}`
}
