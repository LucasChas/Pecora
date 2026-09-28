import { money } from './format'
import { detalleDe, textoEnvio, totalesDe } from './orders'
import { etiquetaEnvioPedido, sucursalDePedido } from './transportistas'
import type { EstadoPedido, Pedido } from '../types'

// ============================================================================
// Comprobante de compra (clienta → "Mis pedidos" → "Descargar comprobante").
// Lógica pura: arma todo lo que se muestra en el comprobante a partir de la
// fila del pedido y los datos de contacto de la tienda. No es una factura: el
// documento lleva siempre la leyenda LEYENDA_NO_FACTURA.
//
// Parte de esto lo comparte la nota de entrega del panel (OrderPrintView):
// lineaLocalidad() y lineasTotales() generan exactamente lo que ya mostraba.
// ============================================================================

export const LEYENDA_NO_FACTURA = 'Documento no válido como factura'

// Zona horaria de la tienda: la fecha del comprobante no depende de dónde esté
// el teléfono de la clienta.
export const ZONA_HORARIA_TIENDA = 'America/Argentina/Cordoba'

// Cómo se le muestra el estado a la clienta (más amable que el interno).
export const ESTADO_CLIENTE: Record<EstadoPedido, { texto: string; clase: string }> = {
  nuevo: { texto: 'Pedido recibido', clase: 'e-nuevo' },
  confirmado: { texto: 'Confirmado · en preparación', clase: 'e-confirmado' },
  entregado: { texto: 'Entregado', clase: 'e-entregado' },
  cancelado: { texto: 'Cancelado', clase: 'e-cancelado' },
}

// Un pedido que la admin mandó a la papelera se le muestra a la clienta como
// "Cancelado": para ella el efecto es el mismo y así no desaparece sin aviso
// (ver migración 0010).
export function estadoVisible(pedido: Pick<Pedido, 'estado' | 'eliminado_at'>): EstadoPedido {
  return pedido.eliminado_at ? 'cancelado' : pedido.estado
}

// "28/09/2026 14:35" en la hora de la tienda. Cadena vacía si la fecha no es válida.
export function fechaHoraTienda(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const partes = new Intl.DateTimeFormat('es-AR', {
    timeZone: ZONA_HORARIA_TIENDA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const p = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((x) => x.type === tipo)?.value ?? ''
  return `${p('day')}/${p('month')}/${p('year')} ${p('hour')}:${p('minute')}`
}

// "Localidad · CP 5000 · Provincia", con lo que haya cargado.
export function lineaLocalidad(
  pedido: Partial<Pick<Pedido, 'localidad' | 'cp' | 'provincia'>>,
): string {
  return [pedido.localidad, pedido.cp ? `CP ${pedido.cp}` : null, pedido.provincia]
    .filter(Boolean)
    .join(' · ')
}

// ---- Totales ------------------------------------------------------------------

export interface LineaTotal {
  etiqueta: string
  valor: string
  // La fila del total (va resaltada).
  total?: boolean
}

// Subtotal, descuento (con el cupón) o el cupón solo (envío gratis), envío
// (con la zona o el transportista) y total. Mismo criterio que la nota de
// entrega: el envío siempre figura, con su costo, "Gratis", "A coordinar" o
// "Sin costo" (ver textoEnvio).
export function lineasTotales(pedido: Pedido): LineaTotal[] {
  const t = totalesDe(pedido)
  const detalle = detalleDe(pedido)
  const lineas: LineaTotal[] = [{ etiqueta: 'Subtotal', valor: money(t.subtotal) }]
  if (t.descuento > 0) {
    lineas.push({
      etiqueta: `Descuento${detalle.cupon ? ` (${detalle.cupon})` : ''}`,
      valor: `− ${money(t.descuento)}`,
    })
  }
  if (detalle.cupon && t.descuento <= 0) {
    lineas.push({ etiqueta: 'Cupón', valor: detalle.cupon })
  }
  lineas.push({
    etiqueta: `Envío${detalle.zona ? ` (${detalle.zona})` : ''}`,
    valor: textoEnvio(t, pedido.entrega, detalle),
  })
  lineas.push({ etiqueta: 'Total', valor: money(t.total), total: true })
  return lineas
}

// ---- Entrega --------------------------------------------------------------------

export interface EntregaComprobante {
  // "Envío a domicilio" / "Envío a sucursal" / "Retiro / a coordinar".
  metodo: string
  // Detalle: transportista y servicio, sucursal o zona, según haya.
  detalle: string[]
}

export function entregaComprobante(pedido: Pedido): EntregaComprobante {
  if (pedido.entrega !== 'envio') return { metodo: 'Retiro / a coordinar', detalle: [] }
  const transportista = etiquetaEnvioPedido(pedido)
  const sucursal = transportista ? sucursalDePedido(pedido) : null
  const zona = pedido.zona_nombre?.trim() || null
  const aSucursal = pedido.servicio_envio === 'sucursal' && transportista !== null
  const detalle: string[] = []
  if (transportista) detalle.push(`Transporte: ${transportista}`)
  if (sucursal) detalle.push(`Sucursal: ${sucursal}`)
  if (!transportista && zona) detalle.push(`Zona: ${zona}`)
  return { metodo: aSucursal ? 'Envío a sucursal' : 'Envío a domicilio', detalle }
}

// ---- Tienda ---------------------------------------------------------------------

// Datos de contacto de la tienda (vienen del .env). Todos opcionales: lo que
// falte no se imprime.
export interface DatosTienda {
  // Con el + del formato internacional (whatsappVisible()).
  whatsapp?: string | null
  // Usuario sin @.
  instagram?: string | null
  direccion?: string | null
  // Dominio del muestrario (catalogoHost()).
  catalogo?: string | null
}

function limpio(valor: string | null | undefined): string | null {
  const t = valor?.trim() ?? ''
  return t === '' ? null : t
}

export function contactoTienda(tienda: DatosTienda): string[] {
  const whatsapp = limpio(tienda.whatsapp)
  const instagram = limpio(tienda.instagram)?.replace(/^@+/, '') || null
  return [
    limpio(tienda.direccion),
    whatsapp ? `WhatsApp ${whatsapp}` : null,
    instagram ? `Instagram @${instagram}` : null,
    limpio(tienda.catalogo),
  ].filter((l): l is string => l !== null)
}

// ---- Comprobante completo ---------------------------------------------------------

export interface ItemComprobante {
  nombre: string
  cantidad: number
  precioUnitario: string
  importe: string
}

export interface Comprobante {
  titulo: string
  numero: number
  fecha: string
  estado: EstadoPedido
  estadoTexto: string
  cancelado: boolean
  leyenda: string
  tienda: string[]
  cliente: string[]
  clienteNombre: string
  entrega: EntregaComprobante
  items: ItemComprobante[]
  totales: LineaTotal[]
  notas: string | null
}

export function armarComprobante(pedido: Pedido, tienda: DatosTienda): Comprobante {
  const estado = estadoVisible(pedido)
  const cliente: string[] = []
  if (limpio(pedido.telefono)) cliente.push(`Tel. ${pedido.telefono.trim()}`)
  const email = limpio(pedido.email)
  if (email) cliente.push(email)
  if (pedido.entrega === 'envio') {
    const direccion = limpio(pedido.direccion)
    if (direccion) cliente.push(direccion)
    const localidad = lineaLocalidad(pedido)
    if (localidad) cliente.push(localidad)
  }
  return {
    titulo: 'Comprobante de compra',
    numero: pedido.numero,
    fecha: fechaHoraTienda(pedido.created_at),
    estado,
    estadoTexto: estado === 'cancelado' ? 'Pedido cancelado' : ESTADO_CLIENTE[estado].texto,
    cancelado: estado === 'cancelado',
    leyenda: LEYENDA_NO_FACTURA,
    tienda: contactoTienda(tienda),
    cliente,
    clienteNombre: pedido.nombre.trim(),
    entrega: entregaComprobante(pedido),
    items: pedido.items.map((i) => ({
      nombre: i.nombre,
      cantidad: i.cantidad,
      precioUnitario: money(i.precio),
      importe: money(i.precio * i.cantidad),
    })),
    totales: lineasTotales(pedido),
    notas: limpio(pedido.notas),
  }
}

// Título del documento: es el nombre por defecto del PDF al "Guardar como PDF".
export function tituloDocumento(numero: number): string {
  return `Pecora - Comprobante pedido #${numero}`
}
