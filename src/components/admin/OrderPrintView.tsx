import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import logoUrl from '../../assets/logo.png'
import type { Pedido } from '../../types'
import { money } from '../../lib/format'
import { catalogoHost, remitenteDireccion, whatsappVisible } from '../../lib/config'
import { lineaLocalidad, lineasTotales } from '../../lib/comprobante'
import { etiquetaEnvioPedido, sucursalDePedido } from '../../lib/transportistas'
import { useVistaImpresion } from '../../hooks/useVistaImpresion'
import '../../styles/order-print.css'

export type TipoImpresion = 'nota' | 'etiqueta'

interface Props {
  pedido: Pedido
  tipo: TipoImpresion
  onClose: () => void
}

// @page no se puede acotar a una clase: la regla se monta solo mientras esta
// vista está abierta, así no cambia cómo se imprime el resto de la app.
const PAGINA: Record<TipoImpresion, string> = {
  nota: '@page { size: A4; margin: 12mm; }',
  etiqueta: '@page { size: 100mm 150mm; margin: 4mm; }',
}

const PREFIJO_LOG = '[imprimir pedido]'

// Dirección del remitente (opcional, VITE_REMITENTE_DIRECCION en el .env).
const REMITENTE_DIRECCION = remitenteDireccion()

function fecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function cantidadPrendas(pedido: Pedido): string {
  const n = pedido.items.reduce((total, i) => total + i.cantidad, 0)
  return n === 1 ? '1 prenda' : `${n} prendas`
}

// Vista de impresión de un pedido (card del panel → "Imprimir"): nota de
// entrega A4 o etiqueta de envío 10×15. Se monta en un portal sobre
// document.body, a pantalla completa, con una barra (Imprimir / Cerrar) que no
// sale en papel. Mientras está abierta se monta la regla @page del formato
// elegido y rige la mecánica de useVistaImpresion (solo el portal se imprime,
// document.title = "Pecora - Nota de entrega #N" / "Pecora - Etiqueta #N",
// resto de la página inerte). Al desmontarse se restaura todo.
export default function OrderPrintView({ pedido, tipo, onClose }: Props) {
  const raizRef = useRef<HTMLDivElement>(null)
  const titulo =
    tipo === 'nota'
      ? `Pecora - Nota de entrega #${pedido.numero}`
      : `Pecora - Etiqueta #${pedido.numero}`

  // Último onClose, para no volver a suscribir el teclado en cada render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const listo = useVistaImpresion(raizRef, titulo, PREFIJO_LOG)

  // Escape cierra la vista.
  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [])

  return createPortal(
    <div
      className="op-portal"
      ref={raizRef}
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      tabIndex={-1}
    >
      <style>{PAGINA[tipo]}</style>

      <div className="op-toolbar">
        <div className="op-toolbar-info">
          <strong>
            {tipo === 'nota' ? 'Nota de entrega' : 'Etiqueta de envío'} · Pedido #{pedido.numero}
          </strong>
          <span>
            {tipo === 'nota' ? 'Hoja A4' : 'Etiqueta 10 × 15 cm'} · Al imprimir podés elegir
            "Guardar como PDF".
          </span>
        </div>
        <div className="op-toolbar-acciones">
          <button type="button" className="op-btn op-btn--ghost" onClick={onClose}>
            Cerrar
          </button>
          <button
            type="button"
            className="op-btn op-btn--primary"
            disabled={!listo}
            onClick={() => window.print()}
          >
            {listo ? 'Imprimir' : 'Preparando…'}
          </button>
        </div>
      </div>

      <div className="op-lienzo">
        {tipo === 'nota' ? <NotaEntrega pedido={pedido} /> : <EtiquetaEnvio pedido={pedido} />}
      </div>
    </div>,
    document.body,
  )
}

// ---- Nota de entrega (A4) ------------------------------------------------------

const FIRMAS = ['Recibí conforme', 'Aclaración', 'Fecha']

function NotaEntrega({ pedido }: { pedido: Pedido }) {
  const esEnvio = pedido.entrega === 'envio'
  const transportista = etiquetaEnvioPedido(pedido)
  const sucursal = sucursalDePedido(pedido)

  return (
    <article className="op-hoja op-nota">
      <header className="op-nota-cabecera">
        <img className="op-nota-logo" src={logoUrl} alt="Pecora" />
        <div className="op-nota-titulo">
          <h1>Nota de entrega</h1>
          <p className="op-nota-numero">N° {pedido.numero}</p>
          <p className="op-nota-meta">
            {fecha(pedido.created_at)} · {pedido.origen === 'admin' ? 'Pedido manual' : 'Pedido web'}
          </p>
        </div>
      </header>

      <section className="op-nota-partes">
        <div className="op-bloque">
          <h2>Remitente</h2>
          <p className="op-bloque-nombre">Pecora</p>
          {REMITENTE_DIRECCION && <p>{REMITENTE_DIRECCION}</p>}
          <p>WhatsApp {whatsappVisible()}</p>
          <p>{catalogoHost()}</p>
        </div>
        <div className="op-bloque">
          <h2>Destinatario</h2>
          <p className="op-bloque-nombre">{pedido.nombre}</p>
          <p>Tel. {pedido.telefono}</p>
          {pedido.email && <p>{pedido.email}</p>}
          {esEnvio ? (
            <>
              {pedido.direccion && <p>{pedido.direccion}</p>}
              {lineaLocalidad(pedido) && <p>{lineaLocalidad(pedido)}</p>}
              {transportista && <p>Envío: {transportista}</p>}
              {transportista && sucursal && <p>Sucursal: {sucursal}</p>}
            </>
          ) : (
            <p>Retiro / a coordinar</p>
          )}
        </div>
      </section>

      <table className="op-tabla">
        <thead>
          <tr>
            <th className="op-num">Cant.</th>
            <th>Producto</th>
            <th className="op-num">Precio unit.</th>
            <th className="op-num">Importe</th>
          </tr>
        </thead>
        <tbody>
          {pedido.items.map((i, idx) => (
            <tr key={idx}>
              <td className="op-num">{i.cantidad}</td>
              <td>{i.nombre}</td>
              <td className="op-num">{money(i.precio)}</td>
              <td className="op-num">{money(i.precio * i.cantidad)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="op-nota-resumen">
        {pedido.notas ? (
          <div className="op-notas">
            <h2>Notas</h2>
            <p>{pedido.notas}</p>
          </div>
        ) : (
          <div />
        )}
        <dl className="op-totales">
          {lineasTotales(pedido).map((l) => (
            <div className={l.total ? 'op-totales-total' : undefined} key={l.etiqueta}>
              <dt>{l.etiqueta}</dt>
              <dd>{l.valor}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="op-firmas" aria-label="Conformidad de entrega">
        {FIRMAS.map((rotulo) => (
          <div className="op-firma" key={rotulo}>
            <span className="op-firma-linea" />
            <span>{rotulo}</span>
          </div>
        ))}
      </section>

      <footer className="op-nota-footer">
        Documento no válido como factura · Pedido #{pedido.numero}
      </footer>
    </article>
  )
}

// ---- Etiqueta de envío (10 × 15 cm) ------------------------------------------------

// Pensada para impresora térmica o blanco y negro: bordes gruesos, alto
// contraste, sin fondos de color.
function EtiquetaEnvio({ pedido }: { pedido: Pedido }) {
  const localidad = [pedido.localidad, pedido.cp ? `CP ${pedido.cp}` : null]
    .filter(Boolean)
    .join(' · ')
  const transportista = etiquetaEnvioPedido(pedido)
  const sucursal = transportista ? sucursalDePedido(pedido) : null

  return (
    <article className="op-hoja op-etiqueta-hoja">
      <div className="op-etiqueta">
        <div className="op-etq-cabecera">
          <span className="op-etq-marca">PECORA</span>
          <span className="op-etq-numero">N° {pedido.numero}</span>
        </div>

        <div className="op-etq-destino">
          <span className="op-etq-rotulo">Destinatario</span>
          <p className="op-etq-nombre">{pedido.nombre}</p>
          {pedido.direccion && <p className="op-etq-dir">{pedido.direccion}</p>}
          {localidad && <p className="op-etq-dir">{localidad}</p>}
          {pedido.provincia && <p className="op-etq-dir">{pedido.provincia}</p>}
          <p className="op-etq-tel">Tel. {pedido.telefono}</p>
        </div>

        {transportista && (
          <div className="op-etq-transporte">
            <span className="op-etq-rotulo">Envío</span>
            <p className="op-etq-transporte-nombre">{transportista}</p>
            {sucursal && <p>Sucursal: {sucursal}</p>}
          </div>
        )}

        <div className="op-etq-remitente">
          <span className="op-etq-rotulo">Remitente</span>
          <p>Pecora · WhatsApp {whatsappVisible()}</p>
          {REMITENTE_DIRECCION && <p>{REMITENTE_DIRECCION}</p>}
          <p>{catalogoHost()}</p>
        </div>

        <div className="op-etq-pie">
          <span>{fecha(pedido.created_at)}</span>
          <span>{cantidadPrendas(pedido)}</span>
        </div>
      </div>
    </article>
  )
}
