import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import logoUrl from '../../assets/logo.png'
import type { Pedido } from '../../types'
import { money } from '../../lib/format'
import { catalogoHost, whatsappVisible } from '../../lib/config'
import { detalleDe, textoEnvio, totalesDe } from '../../lib/orders'
import { useCerrarConAtras } from '../../hooks/useCerrarConAtras'
import '../../styles/order-print.css'

// 'nota' y 'etiqueta': panel (card del pedido → Imprimir).
// 'comprobante': la clienta, desde "Mis pedidos" (no lleva firmas).
export type TipoImpresion = 'nota' | 'etiqueta' | 'comprobante'

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
  comprobante: '@page { size: A4; margin: 12mm; }',
}

const NOMBRE: Record<TipoImpresion, string> = {
  nota: 'Nota de entrega',
  etiqueta: 'Etiqueta de envío',
  comprobante: 'Comprobante de compra',
}

// Cómo se nombra el estado en el comprobante de la clienta.
const ESTADO_COMPROBANTE: Record<Pedido['estado'], string> = {
  nuevo: 'Pedido recibido',
  confirmado: 'Confirmado',
  enviado: 'Enviado',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
}

// Tipografías de marca que usa la plantilla. Se piden explícitamente: si no,
// document.fonts.ready puede resolverse antes de que el navegador las necesite.
const FUENTES = [
  '400 12px Inter',
  '600 12px Inter',
  '700 12px Inter',
  '500 20px Fraunces',
  '600 20px Fraunces',
]

// Tope para esperar tipografías y logo: pasado ese tiempo se habilita igual.
const TOPE_ESPERA_MS = 8_000

const PREFIJO_LOG = '[imprimir pedido]'

// Dirección del remitente (opcional, VITE_REMITENTE_DIRECCION en el .env). Se
// lee con un cast local porque la variable no está declarada en vite-env.d.ts.
const REMITENTE_DIRECCION = (
  (import.meta.env as { VITE_REMITENTE_DIRECCION?: string }).VITE_REMITENTE_DIRECCION ?? ''
).trim()

function fecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

// "Localidad · CP 5000 · Provincia", con lo que haya cargado.
function lineaLocalidad(pedido: Pedido): string {
  return [pedido.localidad, pedido.cp ? `CP ${pedido.cp}` : null, pedido.provincia]
    .filter(Boolean)
    .join(' · ')
}

function cantidadPrendas(pedido: Pedido): string {
  const n = pedido.items.reduce((total, i) => total + i.cantidad, 0)
  return n === 1 ? '1 prenda' : `${n} prendas`
}

// Resuelve cuando cargaron las tipografías y todas las <img> de `raiz`
// (bien o con error: una imagen rota no traba la impresión).
function esperarRecursos(raiz: HTMLElement | null): Promise<void> {
  const fuentes = document.fonts
  const esperaFuentes = Promise.all(
    FUENTES.map((f) => fuentes.load(f).catch(() => [])),
  ).then(() => fuentes.ready)
  const esperaImagenes = Array.from(raiz?.querySelectorAll('img') ?? []).map((img) =>
    img.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true })
          img.addEventListener('error', () => resolve(), { once: true })
        }),
  )
  return Promise.all([esperaFuentes, ...esperaImagenes]).then(() => undefined)
}

// Vista de impresión de un pedido: nota de entrega A4 o etiqueta de envío
// 10×15 (card del panel → "Imprimir"), o comprobante de compra A4 (la
// clienta, desde "Mis pedidos"). Se monta en un portal sobre
// document.body, a pantalla completa, con una barra (Imprimir / Cerrar) que no
// sale en papel. Mientras está abierta:
//   - <html> lleva la clase op-activo: al imprimir se oculta todo lo que no
//     sea el portal (ver order-print.css);
//   - se monta la regla @page del formato elegido;
//   - document.title pasa a "Pecora - Nota de entrega #N" / "Pecora -
//     Etiqueta #N" (es el nombre por defecto del PDF);
//   - el resto de la página queda inerte (sin foco ni clics).
// Al desmontarse se restaura todo.
export default function OrderPrintView({ pedido, tipo, onClose }: Props) {
  const raizRef = useRef<HTMLDivElement>(null)
  const [listo, setListo] = useState(false)
  const titulo =
    tipo === 'etiqueta'
      ? `Pecora - Etiqueta #${pedido.numero}`
      : `Pecora - ${NOMBRE[tipo]} #${pedido.numero}`
  const esClienta = tipo === 'comprobante'

  // Último onClose, para no volver a suscribir el teclado en cada render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const html = document.documentElement
    const tituloAnterior = document.title
    document.title = titulo
    html.classList.add('op-activo')

    const inertes: Element[] = []
    for (const el of Array.from(document.body.children)) {
      if (el === raizRef.current || el.hasAttribute('inert')) continue
      el.setAttribute('inert', '')
      inertes.push(el)
    }
    raizRef.current?.focus()

    return () => {
      document.title = tituloAnterior
      html.classList.remove('op-activo')
      for (const el of inertes) el.removeAttribute('inert')
    }
  }, [titulo])

  // El botón Atrás del celular cierra la vista en vez de salir de la página.
  useCerrarConAtras(true, () => onCloseRef.current())

  // Escape cierra la vista.
  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [])

  // "Imprimir" se habilita cuando cargaron tipografías y logo (con tope).
  useEffect(() => {
    let activo = true
    let temporizador: number | undefined
    const tope = new Promise<'tope'>((resolve) => {
      temporizador = window.setTimeout(() => resolve('tope'), TOPE_ESPERA_MS)
    })
    Promise.race([esperarRecursos(raizRef.current), tope]).then((resultado) => {
      if (!activo) return
      if (resultado === 'tope') {
        console.warn(`${PREFIJO_LOG} Tipografías o logo sin terminar de cargar; se habilita igual.`)
      }
      setListo(true)
    })
    return () => {
      activo = false
      window.clearTimeout(temporizador)
    }
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
            {NOMBRE[tipo]} · Pedido #{pedido.numero}
          </strong>
          <span>
            {esClienta
              ? 'Tocá "Descargar PDF" y elegí "Guardar como PDF" (en iPhone: Compartir → Guardar en Archivos).'
              : `${tipo === 'nota' ? 'Hoja A4' : 'Etiqueta 10 × 15 cm'} · Al imprimir podés elegir "Guardar como PDF".`}
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
            {listo ? (esClienta ? 'Descargar PDF' : 'Imprimir') : 'Preparando…'}
          </button>
        </div>
      </div>

      <div className="op-lienzo">
        {tipo === 'etiqueta' ? (
          <EtiquetaEnvio pedido={pedido} />
        ) : (
          <NotaEntrega pedido={pedido} comprobante={esClienta} />
        )}
      </div>
    </div>,
    document.body,
  )
}

// ---- Nota de entrega (A4) ------------------------------------------------------

const FIRMAS = ['Recibí conforme', 'Aclaración', 'Fecha']

// Con `comprobante` es la versión para la clienta: "Comprobante de compra",
// con el estado, el pago y el seguimiento, sin las líneas de firma.
function NotaEntrega({ pedido, comprobante = false }: { pedido: Pedido; comprobante?: boolean }) {
  const t = totalesDe(pedido)
  const detalle = detalleDe(pedido)
  const esEnvio = pedido.entrega === 'envio'
  const estado = pedido.eliminado_at ? 'cancelado' : pedido.estado

  return (
    <article className="op-hoja op-nota">
      <header className="op-nota-cabecera">
        <img className="op-nota-logo" src={logoUrl} alt="Pecora" />
        <div className="op-nota-titulo">
          <h1>{comprobante ? 'Comprobante de compra' : 'Nota de entrega'}</h1>
          <p className="op-nota-numero">N° {pedido.numero}</p>
          <p className="op-nota-meta">
            {fecha(pedido.created_at)} ·{' '}
            {comprobante
              ? ESTADO_COMPROBANTE[estado]
              : pedido.origen === 'admin'
                ? 'Pedido manual'
                : 'Pedido web'}
          </p>
          {comprobante && estado !== 'cancelado' && (
            <p className="op-nota-meta">
              {pedido.pagado_at ? `Pago recibido el ${fecha(pedido.pagado_at)}` : 'Pago pendiente'}
              {pedido.seguimiento ? ` · Seguimiento: ${pedido.seguimiento}` : ''}
            </p>
          )}
        </div>
      </header>

      <section className="op-nota-partes">
        <div className="op-bloque">
          <h2>{comprobante ? 'Vendedor' : 'Remitente'}</h2>
          <p className="op-bloque-nombre">Pecora</p>
          {REMITENTE_DIRECCION && <p>{REMITENTE_DIRECCION}</p>}
          <p>WhatsApp {whatsappVisible()}</p>
          <p>{catalogoHost()}</p>
        </div>
        <div className="op-bloque">
          <h2>{comprobante ? 'Cliente' : 'Destinatario'}</h2>
          <p className="op-bloque-nombre">{pedido.nombre}</p>
          <p>Tel. {pedido.telefono}</p>
          {pedido.email && <p>{pedido.email}</p>}
          {esEnvio ? (
            <>
              {pedido.direccion && <p>{pedido.direccion}</p>}
              {lineaLocalidad(pedido) && <p>{lineaLocalidad(pedido)}</p>}
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
          <div>
            <dt>Subtotal</dt>
            <dd>{money(t.subtotal)}</dd>
          </div>
          {t.descuento > 0 && (
            <div>
              <dt>Descuento{detalle.cupon ? ` (${detalle.cupon})` : ''}</dt>
              <dd>− {money(t.descuento)}</dd>
            </div>
          )}
          {detalle.cupon && t.descuento <= 0 && (
            <div>
              <dt>Cupón</dt>
              <dd>{detalle.cupon}</dd>
            </div>
          )}
          <div>
            <dt>Envío{detalle.zona ? ` (${detalle.zona})` : ''}</dt>
            <dd>{textoEnvio(t, pedido.entrega, detalle)}</dd>
          </div>
          <div className="op-totales-total">
            <dt>Total</dt>
            <dd>{money(t.total)}</dd>
          </div>
        </dl>
      </section>

      {!comprobante && (
        <section className="op-firmas" aria-label="Conformidad de entrega">
          {FIRMAS.map((rotulo) => (
            <div className="op-firma" key={rotulo}>
              <span className="op-firma-linea" />
              <span>{rotulo}</span>
            </div>
          ))}
        </section>
      )}

      <footer className="op-nota-footer">
        {comprobante && <>¡Gracias por tu compra! · </>}
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
