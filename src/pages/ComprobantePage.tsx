import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import logoUrl from '../assets/logo.png'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import HeaderActions from '../components/account/HeaderActions'
import { useAuth } from '../context/AuthContext'
import { useVistaImpresion } from '../hooks/useVistaImpresion'
import { armarComprobante, tituloDocumento, type DatosTienda } from '../lib/comprobante'
import { catalogoHost, instagramUsuario, remitenteDireccion, whatsappVisible } from '../lib/config'
import { leerPedidoCreado } from '../lib/orders'
import type { Pedido } from '../types'
import '../styles/catalog.css'
import '../styles/order-print.css'
import '../styles/comprobante.css'

const PREFIJO_LOG = '[comprobante]'

// @page no se puede acotar a una clase: la regla se monta solo mientras el
// comprobante está abierto, así no cambia cómo se imprime el resto de la app.
const PAGINA_A4 = '@page { size: A4; margin: 12mm; }'

function datosTienda(): DatosTienda {
  return {
    whatsapp: whatsappVisible(),
    instagram: instagramUsuario(),
    direccion: remitenteDireccion(),
    catalogo: catalogoHost(),
  }
}

// Número de pedido de la URL: entero positivo o null.
function numeroDeParam(valor: string | undefined): number | null {
  if (!valor || !/^\d+$/.test(valor)) return null
  const n = Number(valor)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

// Comprobante de compra (/mis-pedidos/:numero/comprobante). Solo la dueña del
// pedido lo puede ver: se busca por número Y por su user_id (RLS además
// limita la lectura a sus propios pedidos). No es una factura.
export default function ComprobantePage() {
  const { session, loading: cargandoSesion } = useAuth()
  const { numero: param } = useParams()
  const location = useLocation()
  const numero = numeroDeParam(param)
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'no-encontrado'>('cargando')
  const uid = session?.user.id

  useEffect(() => {
    if (!uid) return
    if (numero === null) {
      setEstado('no-encontrado')
      return
    }
    let activo = true
    setEstado('cargando')
    leerPedidoCreado(numero, uid).then((p) => {
      if (!activo) return
      setPedido(p)
      setEstado(p ? 'listo' : 'no-encontrado')
    })
    return () => {
      activo = false
    }
  }, [numero, uid])

  if (cargandoSesion) return null
  if (!session) {
    return <Navigate to={`/cuenta?next=${encodeURIComponent(location.pathname)}`} replace />
  }

  if (estado === 'listo' && pedido) return <VistaComprobante pedido={pedido} />

  return (
    <div className="catalog-root">
      <header className="cart-header">
        <Link to="/">
          <Logo />
        </Link>
        <HeaderActions />
      </header>
      <Scallop />
      <main className="account mis-pedidos-page">
        {estado === 'cargando' ? (
          <div className="loading-state" role="status">
            <span className="loading-spinner" aria-hidden="true" />
            Preparando el comprobante…
          </div>
        ) : (
          <div className="no-results" role="alert">
            No encontramos ese pedido en tu cuenta.
            <br />
            <Link className="pp-back" to="/mis-pedidos">
              ← Volver a Mis pedidos
            </Link>
          </div>
        )}
      </main>
    </div>
  )
}

// Vista a pantalla completa (portal sobre document.body, como la nota de
// entrega del panel): barra con "Volver" e "Imprimir / Guardar PDF" que no sale
// en papel, y la hoja del comprobante. En pantalla la hoja se adapta al ancho
// del celular, así también se puede leer o capturar sin imprimir.
function VistaComprobante({ pedido }: { pedido: Pedido }) {
  const navigate = useNavigate()
  const raizRef = useRef<HTMLDivElement>(null)
  const c = useMemo(() => armarComprobante(pedido, datosTienda()), [pedido])
  const titulo = tituloDocumento(c.numero)
  const listo = useVistaImpresion(raizRef, titulo, PREFIJO_LOG)
  // Algunos navegadores integrados (apps) no tienen window.print.
  const puedeImprimir = typeof window !== 'undefined' && typeof window.print === 'function'

  // Escape vuelve a "Mis pedidos".
  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key === 'Escape') navigate('/mis-pedidos')
    }
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [navigate])

  return createPortal(
    <div className="op-portal cp-portal" ref={raizRef} tabIndex={-1}>
      <style>{PAGINA_A4}</style>

      <div className="op-toolbar" role="toolbar" aria-label="Acciones del comprobante">
        <div className="op-toolbar-info">
          <strong>Comprobante · Pedido #{c.numero}</strong>
          <span>
            {puedeImprimir
              ? 'Tocá "Imprimir / Guardar PDF" y elegí "Guardar como PDF". También podés sacarle una captura.'
              : 'Este navegador no permite imprimir: abrilo en Chrome o Safari, o sacale una captura.'}
          </span>
        </div>
        <div className="op-toolbar-acciones">
          <Link className="op-btn op-btn--ghost cp-btn-link" to="/mis-pedidos">
            Volver
          </Link>
          {puedeImprimir && (
            <button
              type="button"
              className="op-btn op-btn--primary"
              disabled={!listo}
              onClick={() => window.print()}
            >
              {listo ? 'Imprimir / Guardar PDF' : 'Preparando…'}
            </button>
          )}
        </div>
      </div>

      <main className="op-lienzo">
        <article
          className={`op-hoja op-nota cp-comprobante${c.cancelado ? ' cp-comprobante--cancelado' : ''}`}
          aria-labelledby="cp-titulo"
        >
          <header className="op-nota-cabecera">
            <img className="op-nota-logo" src={logoUrl} alt="Pecora" />
            <div className="op-nota-titulo">
              <h1 id="cp-titulo">{c.titulo}</h1>
              <p className="op-nota-numero">Pedido N° {c.numero}</p>
              {c.fecha && <p className="op-nota-meta">{c.fecha} (hora de Argentina)</p>}
            </div>
          </header>

          <p className="cp-leyenda">{c.leyenda}</p>

          {c.cancelado && (
            <p className="cp-cancelado">
              <strong>Pedido cancelado</strong>
              <span>Este pedido fue cancelado. El comprobante queda como constancia de lo que se pidió.</span>
            </p>
          )}

          <section className="op-nota-partes">
            <div className="op-bloque">
              <h2>Tienda</h2>
              <p className="op-bloque-nombre">Pecora</p>
              {c.tienda.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </div>
            <div className="op-bloque">
              <h2>Cliente</h2>
              <p className="op-bloque-nombre">{c.clienteNombre}</p>
              {c.cliente.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
          </section>

          <section className="op-nota-partes">
            <div className="op-bloque">
              <h2>Entrega</h2>
              <p className="op-bloque-nombre">{c.entrega.metodo}</p>
              {c.entrega.detalle.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </div>
            <div className="op-bloque">
              <h2>Estado del pedido</h2>
              <p className={`op-bloque-nombre cp-estado cp-estado--${c.estado}`}>{c.estadoTexto}</p>
              {c.estadoDetalle.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </div>
          </section>

          <table className="op-tabla cp-tabla">
            <caption className="cp-oculto">Productos del pedido</caption>
            <thead>
              <tr>
                <th scope="col" className="op-num">
                  Cant.
                </th>
                <th scope="col">Producto</th>
                <th scope="col" className="op-num">
                  Precio unit.
                </th>
                <th scope="col" className="op-num">
                  Importe
                </th>
              </tr>
            </thead>
            <tbody>
              {c.items.map((i, idx) => (
                <tr key={idx}>
                  <td className="op-num">{i.cantidad}</td>
                  <td>{i.nombre}</td>
                  <td className="op-num">{i.precioUnitario}</td>
                  <td className="op-num">{i.importe}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <section className="op-nota-resumen">
            {c.notas ? (
              <div className="op-notas">
                <h2>Notas</h2>
                <p>{c.notas}</p>
              </div>
            ) : (
              <div />
            )}
            <dl className="op-totales">
              {c.totales.map((l) => (
                <div className={l.total ? 'op-totales-total' : undefined} key={l.etiqueta}>
                  <dt>{l.etiqueta}</dt>
                  <dd>{l.valor}</dd>
                </div>
              ))}
            </dl>
          </section>

          <footer className="op-nota-footer">
            {c.leyenda} · Pedido #{c.numero}
            {c.cancelado ? ' · Pedido cancelado' : ''}
          </footer>
        </article>
      </main>
    </div>,
    document.body,
  )
}
