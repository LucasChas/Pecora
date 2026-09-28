import { useEffect, useRef, useState } from 'react'
import type { EstadoPedido, Pedido } from '../../types'
import { supabase } from '../../lib/supabaseClient'
import { useDialog } from '../../context/DialogContext'
import { money } from '../../lib/format'
import { textoEnvio, totalesDe } from '../../lib/orders'
import OrderPrintView, { type TipoImpresion } from './OrderPrintView'

interface Props {
  pedido: Pedido
  onChanged: () => void
  // Hora de referencia para el aviso de mails (la pasa la lista, así todas las
  // cards y el banner usan la misma). Si falta, la hora actual.
  ahora?: number
}

const ESTADOS: EstadoPedido[] = ['nuevo', 'confirmado', 'entregado', 'cancelado']

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

// Arma un link de WhatsApp al teléfono de la clienta (normaliza el número a AR).
function waCliente(telefono: string, numero: number): string {
  let d = telefono.replace(/\D/g, '')
  if (d.startsWith('0')) d = d.slice(1)
  if (!d.startsWith('54')) d = '549' + d
  const msg = `Hola! Te escribo por tu pedido #${numero} en Pecora 🐑`
  return `https://wa.me/${d}?text=${encodeURIComponent(msg)}`
}

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
export default function OrderCard({ pedido, onChanged, ahora }: Props) {
  const { confirmar, avisar } = useDialog()
  const enPapelera = pedido.eliminado_at !== null
  const totales = totalesDe(pedido)
  const esEnvio = pedido.entrega === 'envio'
  const mails = mailsPendientes(pedido, ahora ?? Date.now())

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
      if (!ok) {
        onChanged() // devuelve el select al estado real
        return
      }
    }
    const { error } = await supabase.from('pedidos').update({ estado }).eq('id', pedido.id)
    if (error) await avisar({ titulo: 'No se pudo actualizar el estado', mensaje: error.message })
    else onChanged()
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
        </div>
        {/* En la papelera no se cambia el estado: primero hay que restaurarlo. */}
        <select
          className={`order-estado ${pedido.estado}`}
          value={pedido.estado}
          disabled={enPapelera}
          onChange={(e) => cambiarEstado(e.target.value as EstadoPedido)}
        >
          {ESTADOS.map((es) => (
            <option key={es} value={es}>
              {es}
            </option>
          ))}
        </select>
      </div>

      <div className="order-cliente">
        <strong>{pedido.nombre}</strong>
        <a className="order-wa" href={waCliente(pedido.telefono, pedido.numero)} target="_blank" rel="noopener noreferrer">
          {pedido.telefono} · WhatsApp
        </a>
        {pedido.email && <span className="order-email">{pedido.email}</span>}
      </div>

      <div className="order-entrega">
        {pedido.entrega === 'envio' ? (
          <>
            📦 Envío a: {pedido.direccion}, {pedido.localidad} (CP {pedido.cp})
            {pedido.provincia ? `, ${pedido.provincia}` : ''}
          </>
        ) : (
          <>🛍️ Retiro / a coordinar</>
        )}
      </div>

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
              <span>Descuento</span>
              <span>− {money(totales.descuento)}</span>
            </div>
          )}
          {(esEnvio || totales.costoEnvio > 0) && (
            <div className="op-card-linea">
              <span>Envío</span>
              <span>{textoEnvio(totales, pedido.entrega)}</span>
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
            <button type="button" className="order-borrar" onClick={borrarDefinitivo}>
              Eliminar para siempre
            </button>
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
