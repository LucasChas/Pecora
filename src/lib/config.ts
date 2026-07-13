import type { ProductoConCategoria } from '../types'

// ---- Configuración de WhatsApp ----
// El número se toma del .env para poder cambiarlo sin tocar código.
const WHATSAPP_NUMBER = import.meta.env.VITE_WHATSAPP_NUMBER || '5490000000000'

// Mensajes prellenados. Cambiá el texto acá si querés otro tono.
function mensajeWhatsApp(producto: ProductoConCategoria): string {
  const disponible = producto.stock > 0
  return disponible
    ? `Hola! Quería consultar por "${producto.nombre}" (Pecora) que vi en la web.`
    : `Hola! Quería consultar disponibilidad de "${producto.nombre}" (Pecora).`
}

// Arma el link de WhatsApp (wa.me) con el mensaje ya cargado.
export function waLink(producto: ProductoConCategoria): string {
  const msg = mensajeWhatsApp(producto)
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`
}
