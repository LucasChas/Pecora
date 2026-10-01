import type { ProductoConCategoria } from '../types'
import { textoEnvio, type TotalesPedido } from './orders'
import { money } from './format'

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

// URL pública del muestrario (el deploy "catalog"). Se imprime en la lista de
// precios que se exporta desde el panel, que vive en OTRO dominio: por eso no
// sirve window.location. Viene del .env; si falta, usa el dominio de producción.
const CATALOG_URL = import.meta.env.VITE_CATALOG_URL || 'https://pecora-muestrario.vercel.app'

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

// Ítem mínimo para armar el mensaje de pedido.
interface ItemPedido {
  nombre: string
  precio: number
  cantidad: number
}

// Datos del checkout que van en el mensaje del pedido confirmado.
export interface DatosPedido {
  nombre: string
  entrega: 'envio' | 'coordinar'
  direccion?: string
  localidad?: string
  cp?: string
  provincia?: string
  notas?: string
  // Cupón aplicado y zona de envío que asignó la base (si hay).
  cupon?: string
  zona?: string
}

// Bloque de montos del mensaje: subtotal, descuento (con el cupón) y envío
// (con la zona) si corresponden, y el total. Si el envío todavía no tiene
// costo ni zona, se aclara que se coordina.
function resumenMontos(totales: TotalesPedido, datos: DatosPedido): string {
  const lineas = [`Subtotal: ${money(totales.subtotal)}`]
  if (totales.descuento > 0) {
    const cupon = datos.cupon ? ` (cupón ${datos.cupon})` : ''
    lineas.push(`Descuento${cupon}: − ${money(totales.descuento)}`)
  } else if (datos.cupon) {
    lineas.push(`Cupón: ${datos.cupon}`)
  }
  const detalle = { cupon: datos.cupon, zona: datos.zona }
  const zona = datos.zona ? ` (${datos.zona})` : ''
  if (totales.costoEnvio > 0 || datos.entrega === 'envio') {
    const envio = textoEnvio(totales, datos.entrega, detalle)
    lineas.push(`Envío${zona}: ${envio === 'A coordinar' ? 'a coordinar' : envio}`)
  }
  lineas.push(`Total: ${money(totales.total)}`)
  return lineas.join('\n')
}

// Link de WhatsApp para un pedido YA REGISTRADO en la base (checkout):
// incluye el número de orden, el detalle, los montos y los datos de entrega.
export function waPedidoConfirmadoLink(
  numero: number,
  items: ItemPedido[],
  totales: TotalesPedido,
  datos: DatosPedido,
): string {
  const lineas = items
    .map((i) => `• ${i.cantidad}x ${i.nombre} — ${money(i.precio * i.cantidad)}`)
    .join('\n')
  const destino = [
    datos.direccion,
    datos.localidad,
    datos.cp ? `CP ${datos.cp}` : undefined,
    datos.provincia,
  ]
    .filter(Boolean)
    .join(', ')
  const entrega =
    datos.entrega === 'envio' ? `Envío a domicilio: ${destino}` : 'Entrega: a coordinar / retiro'
  const partes = [
    `Hola! Soy ${datos.nombre}. Acabo de hacer el pedido #${numero} en la web de Pecora:`,
    lineas,
    resumenMontos(totales, datos),
    entrega,
  ]
  if (datos.notas) partes.push(`Notas: ${datos.notas}`)
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(partes.join('\n\n'))}`
}

// Link de WhatsApp para preguntar por qué se canceló un pedido. Lo usa la
// clienta desde "Mis pedidos": es su única vía para entender qué pasó. El
// total (si se pasa) ayuda a ubicar el pedido del otro lado.
export function waConsultaCancelacionLink(numero: number, total?: number): string {
  const monto = total !== undefined && total > 0 ? ` (total ${money(total)})` : ''
  const msg =
    `Hola! Vi que mi pedido #${numero}${monto} en Pecora figura como cancelado. ` +
    '¿Me podrías decir qué pasó?'
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`
}

// Número de WhatsApp de la marca para mostrarlo impreso (nota de entrega y
// etiqueta), con el + del formato internacional.
export function whatsappVisible(): string {
  return `+${WHATSAPP_NUMBER}`
}

// ¿Está configurado Instagram? (para mostrar u ocultar el botón)
export const instagramHabilitado = INSTAGRAM_USER !== ''

// Link de perfil de Instagram (para contacto general, ej. en el footer).
export function instagramPerfilLink(): string {
  return `https://instagram.com/${INSTAGRAM_USER}`
}

// Link de WhatsApp genérico (sin producto), para contacto general en el footer.
export function waPerfilLink(): string {
  return `https://wa.me/${WHATSAPP_NUMBER}`
}

// Link de mensaje directo (DM) de Instagram. ig.me/m abre el chat con la marca,
// análogo a wa.me. Instagram no permite prellenar el texto, así que el mensaje
// lo escribe la clienta (a diferencia de WhatsApp).
export function instagramDmLink(): string {
  return `https://ig.me/m/${INSTAGRAM_USER}`
}

// Dominio del muestrario sin protocolo ni barra final, para mostrarlo impreso
// (ej. "pecora-muestrario.vercel.app").
export function catalogoHost(): string {
  return CATALOG_URL.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

// URL pública completa del muestrario, con protocolo y sin barra final
// (ej. "https://pecora-muestrario.vercel.app"). Es la base de los links que se
// comparten: siempre apunta al deploy público, se esté en el que se esté.
export function catalogoUrl(): string {
  const base = CATALOG_URL.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(base) ? base : `https://${base}`
}

// Usuario de Instagram de la marca (sin @), o cadena vacía si no está
// configurado. Se imprime en el comprobante de compra.
export function instagramUsuario(): string {
  return INSTAGRAM_USER.trim().replace(/^@+/, '')
}

// Dirección de la tienda / remitente (VITE_REMITENTE_DIRECCION, opcional).
// Cadena vacía si no está configurada: los documentos impresos la omiten.
export function remitenteDireccion(): string {
  return (import.meta.env.VITE_REMITENTE_DIRECCION ?? '').trim()
}
