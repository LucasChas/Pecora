import { useEffect, useRef, useState } from 'react'
import type { EstadoPedido, Pedido } from '../../types'
import { supabase } from '../../lib/supabaseClient'
import { useDialog } from '../../context/DialogContext'
import { money } from '../../lib/format'
import { ETIQUETA_ESTADO, detalleDe, textoEnvio, totalesDe } from '../../lib/orders'
import { etiquetaEnvioPedido, sucursalDePedido } from '../../lib/transportistas'
import { linkWhatsappPedido } from '../../lib/whatsapp'
import OrderPrintView, { type TipoImpresion } from './OrderPrintView'

interface Props {
  pedido: Pedido
  onChanged: () => void
  // Hora de referencia para el aviso de mails (la pasa la lista, así todas las
  // cards y el banner usan la misma). Si falta, la hora actual.
  ahora?: number
  // Solo admin: borrado definitivo desde la papelera. Por defecto oculto.
  puedeBorrarDefinitivo?: boolean
}

const ESTADOS: EstadoPedido[] = ['nuevo', 'confirmado', 'enviado', 'entregado', 'cancelado']

// ---- Mails del pedido: recibo a la clienta y aviso a la dueña ----
// La Edge Function enviar-recibo-pedido marca email_enviado_at y
// aviso_duena_enviado_at al mandar cada mail, segundos después de creado el
// pedido. Si pasados unos minutos siguen vacíos, el envío falló (por ejemplo,
// venció el token de Gmail) y la admin los puede reenviar.
export const GRACIA_MAILS_MS = 2 * 60 * 1000
// Solo pedidos recientes: los anteriores a que existieran las marcas nunca las
// tuvieron, aunque el mail haya salido, y quedarían marcados para siempre.
export const VENTANA_MAILS_MS = 7 * 24 * 60 * 60 * 1000

export interface MailsPendientes {
  recibo: boolean
  aviso: boolean
}

// Qué mails de un pedido web no salieron. null si no hay nada que avisar.
export function mailsPendientes(pedido: Pedido, ahora: number): MailsPendientes | null {
  if (pedido.origen !== 'checkout') return null
  if (pedido.eliminado_at !== null || pedido.estado === 'cancelado') return null
  // Sin la migración de totales las filas no traen las marcas: no se sabe nada.
  if (pedido.email_enviado_at === undefined || pedido.aviso_duena_enviado_at === undefined) return null
  const edad = ahora - Date.parse(pedido.created_at)
  if (!(edad >= GRACIA_MAILS_MS && edad <= VENTANA_MAILS_MS)) return null
  // Sin email en el pedido, la función usa el de la cuenta de la clienta.
  const recibo = pedido.email_enviado_at === null && Boolean(pedido.email?.trim() || pedido.user_id)
  const aviso = pedido.aviso_duena_enviado_at === null
  return recibo || aviso ? { recibo, aviso } : null
}

type EstadoReenvio = 'listo' | 'enviando' | 'solicitado'

function fecha(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Card de un pedido en el panel: datos de la clienta, entrega, ítems, totales,
// un selector para cambiar el estado y el menú "Imprimir" (nota de entrega y,
// si es envío, etiqueta).
export default function OrderCard({ pedido, onChanged, ahora, puedeBorrarDefinitivo = false }: Props) {
  const { confirmar, avisar, notificar } = useDialog()
  const enPapelera = pedido.eliminado_at !== null
  const totales = totalesDe(pedido)
  const detalle = detalleDe(pedido)
  const esEnvio = pedido.entrega === 'envio'
  // Transportista y sucursal (si el envío se cotizó con Andreani / Correo).
  const envioTransportista = etiquetaEnvioPedido(pedido)
  const sucursal = envioTransportista ? sucursalDePedido(pedido) : null
  const mails = mailsPendientes(pedido, ahora ?? Date.now())

  // Estado que se muestra en el selector: cambia al instante al elegir (antes
  // volvía al anterior hasta que respondía la base y parecía que no anduvo).
  const [estadoVisible, setEstadoVisible] = useState<EstadoPedido>(pedido.estado)
  useEffect(() => setEstadoVisible(pedido.estado), [pedido.estado])
  const linkWa = linkWhatsappPedido({ ...pedido, estado: estadoVisible, total: totales.total })

  // Seguimiento del correo: se guarda al salir del campo.
  const [seguimiento, setSeguimiento] = useState(pedido.seguimiento ?? '')
  useEffect(() => setSeguimiento(pedido.seguimiento ?? ''), [pedido.seguimiento])
  // Sin la migración de pago/seguimiento las filas no traen las columnas.
  const tienePago = pedido.pagado_at !== undefined

  const [reenvio, setReenvio] = useState<EstadoReenvio>('listo')
  const [menuImprimir, setMenuImprimir] = useState(false)
  const [impresion, setImpresion] = useState<TipoImpresion | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const botonImprimirRef = useRef<HTMLButtonElement>(null)
  const huboImpresion = useRef(false)

  // Menú abierto: se cierra al tocar afuera o con Escape (el foco vuelve al botón).
  useEffect(() => {
    if (!menuImprimir) return
    function alTocar(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuImprimir(false)
    }
    function alTeclear(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setMenuImprimir(false)
      botonImprimirRef.current?.focus()
    }
    document.addEventListener('pointerdown', alTocar)
    document.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('pointerdown', alTocar)
      document.removeEventListener('keydown', alTeclear)
    }
  }, [menuImprimir])

  // Al cerrar la vista de impresión, el foco vuelve al botón "Imprimir".
  useEffect(() => {
    if (impresion) huboImpresion.current = true
    else if (huboImpresion.current) botonImprimirRef.current?.focus()
  }, [impresion])

  // "Reenvío solicitado" dura un minuto: si el mail vuelve a fallar, se puede
  // intentar de nuevo. Si sale, la marca llega por realtime y el aviso se va.
  useEffect(() => {
    if (reenvio !== 'solicitado') return
    const t = window.setTimeout(() => setReenvio('listo'), 60 * 1000)
    return () => window.clearTimeout(t)
  }, [reenvio])

  function abrirImpresion(tipo: TipoImpresion) {
    setMenuImprimir(false)
    setImpresion(tipo)
  }

  // Vuelve a invocar la Edge Function (RPC solo para la admin). La función
  // solo manda lo que todavía no salió.
  async function reenviarMails() {
    setReenvio('enviando')
    const { error } = await supabase.rpc('reenviar_emails_pedido', { p_pedido_id: pedido.id })
    if (error) {
      setReenvio('listo')
      const faltaMigracion = error.code === 'PGRST202' || error.code === '42883'
      await avisar({
        titulo: 'No se pudieron reenviar los mails',
        mensaje: faltaMigracion
          ? 'Falta aplicar la migración reenviar_emails_pedido en Supabase.'
          : error.message,
      })
      return
    }
    setReenvio('solicitado')
  }

  async function cambiarEstado(estado: EstadoPedido) {
    // Cancelar se le avisa a la clienta al instante (realtime) y no hay deshacer:
    // pedimos confirmación para que un toque al pasar no cancele una venta.
    if (estado === 'cancelado') {
      const ok = await confirmar({
        titulo: `¿Cancelar el pedido #${pedido.numero}?`,
        mensaje: `${pedido.nombre} lo va a ver como "Cancelado" y las prendas vuelven al stock.`,
        textoOk: 'Cancelar pedido',
        textoCancelar: 'Volver',
        peligro: true,
      })
      if (!ok) return
    }
    const anterior = pedido.estado
    if (!(await guardarEstado(estado))) return
    // Con un filtro activo el pedido puede desaparecer de la lista: el aviso
    // dice a dónde fue y permite deshacer un toque equivocado.
    // El mail "tu pedido está en camino" espera el seguimiento si es con envío.
    const faltaSeguimiento = estado === 'enviado' && esEnvio && !(pedido.seguimiento ?? '').trim()
    notificar(
      faltaSeguimiento
        ? `Pedido #${pedido.numero} → Enviado. Cargá el seguimiento y le avisamos por mail.`
        : `Pedido #${pedido.numero} → ${ETIQUETA_ESTADO[estado]}`,
      { accion: { texto: 'Deshacer', onClick: () => void guardarEstado(anterior) } },
    )
  }

  async function alternarPago() {
    const pagado_at = pedido.pagado_at ? null : new Date().toISOString()
    const { error } = await supabase.from('pedidos').update({ pagado_at }).eq('id', pedido.id)
    if (error) {
      await avisar({ titulo: 'No se pudo guardar el pago', mensaje: error.message })
      return
    }
    onChanged()
    notificar(pagado_at ? `Pedido #${pedido.numero} marcado como pagado` : `Pedido #${pedido.numero}: pago quitado`)
  }

  // Para pegar en la etiqueta o en la web del correo.
  async function copiarDireccion() {
    const texto = [
      pedido.nombre,
      pedido.direccion,
      [pedido.localidad, pedido.provincia].filter(Boolean).join(', '),
      pedido.cp ? `CP ${pedido.cp}` : '',
      pedido.telefono,
    ]
      .filter(Boolean)
      .join('\n')
    try {
      await navigator.clipboard.writeText(texto)
      notificar('Dirección copiada')
    } catch {
      await avisar({ titulo: 'No se pudo copiar', mensaje: texto })
    }
  }

  async function guardarSeguimiento() {
    const valor = seguimiento.trim() || null
    if (valor === (pedido.seguimiento ?? null)) return
    const { error } = await supabase.from('pedidos').update({ seguimiento: valor }).eq('id', pedido.id)
    if (error) {
      await avisar({ titulo: 'No se pudo guardar el seguimiento', mensaje: error.message })
      return
    }
    onChanged()
    notificar('Seguimiento guardado')
  }

  async function guardarEstado(estado: EstadoPedido): Promise<boolean> {
    setEstadoVisible(estado)
    const { error } = await supabase.from('pedidos').update({ estado }).eq('id', pedido.id)
    if (error) {
      setEstadoVisible(pedido.estado)
      await avisar({ titulo: 'No se pudo actualizar el estado', mensaje: error.message })
      return false
    }
    onChanged()
    return true
  }

  // "Borrar" manda a la papelera: se puede recuperar desde el filtro Eliminados.
  async function aPapelera() {
    const ok = await confirmar({
      titulo: `¿Borrar el pedido #${pedido.numero}?`,
      mensaje:
        'Va a la papelera: lo podés recuperar desde el filtro "Papelera".' +
        (pedido.estado === 'cancelado' ? '' : ' Las prendas vuelven al stock.') +
        ` El cliente ${pedido.nombre} lo va a ver como cancelado.`,
      textoOk: 'Borrar',
      peligro: true,
    })
    if (!ok) return
    const { error } = await supabase
      .from('pedidos')
      .update({ eliminado_at: new Date().toISOString() })
      .eq('id', pedido.id)
    if (error) await avisar({ titulo: 'No se pudo borrar el pedido', mensaje: error.message })
    else onChanged()
  }

  // Restaurar siempre lo devuelve como "nuevo": un pedido que estuvo en la
  // papelera vuelve a la fila para gestionarse desde cero, sin arrastrar el
  // estado que tenía antes.
  async function restaurar() {
    const ok = await confirmar({
      titulo: `¿Restaurar el pedido #${pedido.numero}?`,
      mensaje:
        'Vuelve a la lista como "Nuevo" para gestionarlo de nuevo' +
        (pedido.estado === 'cancelado' ? ' y las prendas se descuentan del stock.' : '.'),
      textoOk: 'Restaurar',
    })
    if (!ok) return
    const { error } = await supabase
      .from('pedidos')
      .update({ eliminado_at: null, estado: 'nuevo' })
      .eq('id', pedido.id)
    // Si vuelve a reservar stock y no alcanza, el trigger de la 0009 lo impide.
    if (error) await avisar({ titulo: 'No se pudo restaurar el pedido', mensaje: error.message })
    else onChanged()
  }

  async function borrarDefinitivo() {
    const ok = await confirmar({
      titulo: `¿Eliminar para siempre el pedido #${pedido.numero}?`,
      mensaje: 'Esta vez no hay vuelta atrás: no queda registro de la compra.',
      textoOk: 'Eliminar',
      peligro: true,
    })
    if (!ok) return
    // El .select() nos dice qué filas se borraron: si RLS no lo permite, el
    // delete no falla, simplemente no borra nada. Sin esto el botón quedaría mudo.
    const { data, error } = await supabase
      .from('pedidos')
      .delete()
      .eq('id', pedido.id)
      .select('id')
    if (error) {
      await avisar({ titulo: 'No se pudo eliminar el pedido', mensaje: error.message })
      return
    }
    if (!data || data.length === 0) {
      await avisar({
        titulo: 'No se pudo eliminar el pedido',
        mensaje: 'Falta correr la migración 0007_borrar_pedidos.sql en Supabase.',
      })
      return
    }
    onChanged()
  }

  return (
    <div className={`order-card estado-${pedido.estado}${enPapelera ? ' en-papelera' : ''}`}>
      <div className="order-top">
        <div>
          <span className="order-num">Pedido #{pedido.numero}</span>
          <span className={`origin-badge origin-badge--${pedido.origen}`}>
            {pedido.origen === 'admin' ? 'Manual' : 'Web'}
          </span>
          <span className="order-fecha">{fecha(pedido.created_at)}</span>
          {tienePago && !pedido.pagado_at && pedido.estado !== 'cancelado' && !enPapelera && (
            <span className="order-pill-pago">Sin pagar</span>
          )}
        </div>
        {/* En la papelera no se cambia el estado: primero hay que restaurarlo. */}
        <select
          className={`order-estado ${estadoVisible}`}
          value={estadoVisible}
          disabled={enPapelera}
          aria-label={`Estado del pedido #${pedido.numero}`}
          onChange={(e) => cambiarEstado(e.target.value as EstadoPedido)}
        >
          {ESTADOS.map((es) => (
            <option key={es} value={es}>
              {ETIQUETA_ESTADO[es]}
            </option>
          ))}
        </select>
      </div>

      <div className="order-cliente">
        <strong>{pedido.nombre}</strong>
        {linkWa ? (
          <a className="order-wa" href={linkWa} target="_blank" rel="noopener noreferrer">
            {pedido.telefono} · WhatsApp
          </a>
        ) : (
          <span className="order-email">{pedido.telefono || 'Sin teléfono'}</span>
        )}
        {pedido.email && <span className="order-email">{pedido.email}</span>}
      </div>

      <div className="order-entrega">
        {pedido.entrega === 'envio' ? (
          <>
            📦 Envío a: {pedido.direccion}, {pedido.localidad} (CP {pedido.cp})
            {pedido.provincia ? `, ${pedido.provincia}` : ''}
            {envioTransportista && (
              <div className="order-transportista">
                <strong>🚚 {envioTransportista}</strong>
                {sucursal && <span>Sucursal: {sucursal}</span>}
              </div>
            )}
          </>
        ) : (
          <>🛍️ Retiro / a coordinar</>
        )}
      </div>

      {tienePago && !enPapelera && pedido.estado !== 'cancelado' && (
        <div className="order-pago">
          <button
            type="button"
            className={pedido.pagado_at ? 'order-pago-btn pagado' : 'order-pago-btn'}
            aria-pressed={Boolean(pedido.pagado_at)}
            onClick={() => void alternarPago()}
          >
            {pedido.pagado_at ? 'Pagado ✓' : 'Marcar como pagado'}
          </button>
          {esEnvio && (
            <>
              <button type="button" className="order-pago-btn" onClick={() => void copiarDireccion()}>
                Copiar dirección
              </button>
              <input
                className="order-seguimiento"
                value={seguimiento}
                onChange={(e) => setSeguimiento(e.target.value)}
                onBlur={() => void guardarSeguimiento()}
                maxLength={300}
                placeholder="N.º o link de seguimiento"
                aria-label={`Seguimiento del envío del pedido #${pedido.numero}`}
              />
            </>
          )}
        </div>
      )}

      <div className="order-items">
        {pedido.items.map((i, idx) => (
          <div className="order-item" key={idx}>
            <span>
              {i.cantidad}x {i.nombre}
            </span>
            <span>{money(i.precio * i.cantidad)}</span>
          </div>
        ))}
        {/* Totales compactos: el envío se muestra si es a domicilio o ya tiene costo. */}
        <div className="op-card-totales">
          <div className="op-card-linea">
            <span>Subtotal</span>
            <span>{money(totales.subtotal)}</span>
          </div>
          {totales.descuento > 0 && (
            <div className="op-card-linea">
              <span>Descuento{detalle.cupon ? ` (${detalle.cupon})` : ''}</span>
              <span>− {money(totales.descuento)}</span>
            </div>
          )}
          {/* Cupón sin descuento en pesos (envío gratis): igual se nombra. */}
          {detalle.cupon && totales.descuento <= 0 && (
            <div className="op-card-linea">
              <span>Cupón</span>
              <span>{detalle.cupon}</span>
            </div>
          )}
          {(esEnvio || totales.costoEnvio > 0) && (
            <div className="op-card-linea">
              <span>Envío{detalle.zona ? ` (${detalle.zona})` : ''}</span>
              <span>{textoEnvio(totales, pedido.entrega, detalle)}</span>
            </div>
          )}
          <div className="op-card-linea op-card-total">
            <span>Total</span>
            <strong>{money(totales.total)}</strong>
          </div>
        </div>
      </div>

      {pedido.notas && <p className="order-notas">📝 {pedido.notas}</p>}

      {mails && (
        <div className="order-mails">
          <ul className="order-mails-lista">
            {mails.recibo && <li>Mail a la clienta: no enviado</li>}
            {mails.aviso && <li>Aviso a la dueña: no enviado</li>}
          </ul>
          <button
            type="button"
            className="order-mails-btn"
            onClick={reenviarMails}
            disabled={reenvio !== 'listo'}
            aria-label={reenvio === 'listo' ? `Reenviar los mails del pedido #${pedido.numero}` : undefined}
          >
            {reenvio === 'enviando'
              ? 'Reenviando…'
              : reenvio === 'solicitado'
                ? 'Reenvío solicitado'
                : 'Reenviar'}
          </button>
        </div>
      )}

      <div className="order-pie">
        {enPapelera ? (
          <>
            <button type="button" className="order-restaurar" onClick={restaurar}>
              ↩ Restaurar
            </button>
            {puedeBorrarDefinitivo && (
              <button type="button" className="order-borrar" onClick={borrarDefinitivo}>
                Eliminar para siempre
              </button>
            )}
          </>
        ) : (
          <>
            <div className="op-menu" ref={menuRef}>
              <button
                type="button"
                ref={botonImprimirRef}
                className="op-menu-btn"
                aria-haspopup="menu"
                aria-expanded={menuImprimir}
                onClick={() => setMenuImprimir((a) => !a)}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M6 9V3h12v6" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <path d="M6 14h12v7H6z" />
                </svg>
                Imprimir
              </button>
              {menuImprimir && (
                <div className="op-menu-lista" role="menu" aria-label={`Imprimir pedido #${pedido.numero}`}>
                  <button type="button" role="menuitem" onClick={() => abrirImpresion('nota')}>
                    Nota de entrega (A4)
                  </button>
                  {esEnvio && (
                    <button type="button" role="menuitem" onClick={() => abrirImpresion('etiqueta')}>
                      Etiqueta de envío (10×15)
                    </button>
                  )}
                </div>
              )}
            </div>
            <button type="button" className="order-borrar" onClick={aPapelera}>
              Borrar pedido
            </button>
          </>
        )}
      </div>

      {/* Vista de impresión: se monta en un portal sobre document.body. */}
      {impresion && (
        <OrderPrintView pedido={pedido} tipo={impresion} onClose={() => setImpresion(null)} />
      )}
    </div>
  )
}
