import { money } from './format'
import type { EstadoPedido } from '../types'

// ---------------------------------------------------------------------------
// Teléfono de una clienta → número para wa.me.
//
// WhatsApp necesita los celulares argentinos como 54 9 <área> <número>, sin
// el 0 del área ni el 15. La gente los escribe de mil formas ("0351 15
// 555-1234", "+54 351 5551234", "3515551234"...) y antes el link salía mal con
// las más comunes. Devuelve null si no alcanza para armar un número.
// ---------------------------------------------------------------------------
export function telefonoParaWhatsapp(telefono: string | null | undefined): string | null {
  const original = (telefono ?? '').trim()
  let d = original.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)

  // Número de otro país escrito con +: se respeta tal cual.
  if (original.startsWith('+') && !d.startsWith('54')) return d.length >= 8 ? d : null

  if (d.startsWith('54')) {
    d = d.slice(2)
    if (d.startsWith('9')) d = d.slice(1)
  }
  if (d.startsWith('0')) d = d.slice(1)

  // <área><15><número>: 12 dígitos. El área tiene 2 (solo 11, AMBA), 3 o 4.
  if (d.length === 12) {
    const largos = d.startsWith('11') ? [2] : [3, 4]
    const area = largos.find((n) => d.slice(n, n + 2) === '15')
    if (area) d = d.slice(0, area) + d.slice(area + 2)
  }

  return d.length === 10 ? `549${d}` : null
}

// Mensaje inicial según en qué está el pedido.
export function mensajePedido(p: {
  numero: number
  nombre: string
  estado: EstadoPedido
  total?: number | null
  entrega?: string
}): string {
  const nombre = p.nombre.trim().split(/\s+/)[0] || ''
  const hola = `Hola ${nombre}!`.replace(' !', '!')
  switch (p.estado) {
    case 'confirmado':
      return (
        `${hola} Tu pedido #${p.numero} de Pecora ya está en preparación 🐑` +
        (p.total ? ` El total es ${money(p.total)}.` : '') +
        (p.entrega === 'envio' ? ' Te aviso cuando lo despachemos.' : ' Te aviso cuando esté listo para retirar.')
      )
    case 'entregado':
      return `${hola} ¿Te llegó bien tu pedido #${p.numero}? Cualquier cosa, escribime 🐑`
    case 'cancelado':
      return `${hola} Te escribo por tu pedido #${p.numero} de Pecora, que figura cancelado.`
    default:
      return `${hola} Te escribo por tu pedido #${p.numero} en Pecora 🐑`
  }
}

export function linkWhatsappPedido(p: Parameters<typeof mensajePedido>[0] & { telefono: string }): string | null {
  const numero = telefonoParaWhatsapp(p.telefono)
  if (!numero) return null
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensajePedido(p))}`
}
