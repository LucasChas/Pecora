import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import HeaderActions from '../components/account/HeaderActions'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { money } from '../lib/format'
import { waConsultaCancelacionLink } from '../lib/config'
import { detalleDe, lineasDesglose, montoLinea, totalesDe } from '../lib/orders'
import { IMG_PLACEHOLDER, portadaDe } from '../lib/images'
import ImageZoom from '../components/common/ImageZoom'
import CalificarProducto from '../components/account/CalificarProducto'
import { Estrellas } from '../components/catalog/ResenasProducto'
import { cargarMisResenas, textoEstrellas, type MiResenaDeProducto } from '../lib/resenas'
import { invalidarResumenesResenas } from '../hooks/useResumenesResenas'
import { useDialog } from '../context/DialogContext'
import type { EstadoPedido, Pedido } from '../types'
import '../styles/catalog.css'
import '../styles/account.css'
import { useTitulo } from '../hooks/useTitulo'

// La vista del comprobante (y su CSS) se baja recién al tocar "Descargar".
const OrderPrintView = lazy(() => import('../components/common/OrderPrintView'))

interface ProductoACalificar {
  id: string
  nombre: string
  imagen: string
}

// Cómo se le muestra el estado a la clienta (más amable que el interno).
const ESTADO_CLIENTE: Record<EstadoPedido, { texto: string; clase: string }> = {
  nuevo: { texto: 'Pedido recibido', clase: 'e-nuevo' },
  confirmado: { texto: 'Confirmado · en preparación', clase: 'e-confirmado' },
  enviado: { texto: 'Enviado · en camino', clase: 'e-enviado' },
  entregado: { texto: 'Entregado', clase: 'e-entregado' },
  cancelado: { texto: 'Cancelado', clase: 'e-cancelado' },
}

// Un pedido que la admin mandó a la papelera se le muestra a la clienta como
// "Cancelado": para ella el efecto es el mismo y así no desaparece sin aviso.
function estadoVisible(pedido: Pedido): EstadoPedido {
  return pedido.eliminado_at ? 'cancelado' : pedido.estado
}

function fecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// "Mis pedidos" (/mis-pedidos): historial de la clienta con el estado en vivo.
// Cuando la admin cambia el estado de un pedido, acá se actualiza solo (Realtime).
export default function MyOrdersPage() {
  const { session, loading: cargandoSesion } = useAuth()
  useTitulo('Mis pedidos')
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [cargando, setCargando] = useState(true)
  // Si la carga falla no decimos "todavía no hiciste pedidos" (falso y
  // alarmante justo después de comprar): mostramos el error con reintento.
  const [errorCarga, setErrorCarga] = useState(false)
  // Miniatura por producto (id -> url). El pedido solo guarda nombre/precio,
  // no imagen (foto "de época"), así que la traemos del producto actual —
  // igual que "por categoría" en las estadísticas, es una aproximación: si
  // el producto cambió de foto o se borró, se ve la portada actual o el
  // placeholder, no la que tenía el día de la compra.
  const [imagenes, setImagenes] = useState<Record<string, string>>({})
  const [zoomSrc, setZoomSrc] = useState<string | null>(null)
  // Productos que todavía existen (los borrados no se pueden calificar).
  const [existentes, setExistentes] = useState<Set<string>>(new Set())
  // Reseñas propias por producto. null = no disponible (no se ofrece calificar).
  const [misResenas, setMisResenas] = useState<Map<string, MiResenaDeProducto> | null>(null)
  const [calificando, setCalificando] = useState<ProductoACalificar | null>(null)
  const [comprobante, setComprobante] = useState<Pedido | null>(null)
  const { notificar } = useDialog()

  const fetchMisResenas = useCallback(async () => {
    const r = await cargarMisResenas()
    setMisResenas(r.ok ? new Map(r.valor.map((x) => [x.producto_id, x])) : null)
  }, [])

  const fetchPedidos = useCallback(async (uid: string) => {
    // Filtramos por user_id explícitamente. No alcanza con confiar en RLS: la
    // política permite leer "los propios O todos si sos admin", así que la
    // administradora vería acá los pedidos de todas las clientas como si fueran
    // suyos. "Mis pedidos" siempre son los de la cuenta logueada.
    let lista: Pedido[]
    try {
      const { data, error } = await supabase
        .from('pedidos')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
      if (error) throw error
      lista = (data ?? []) as Pedido[]
    } catch (e) {
      console.error('No se pudieron cargar los pedidos:', e)
      setErrorCarga(true)
      setCargando(false)
      return
    }
    setErrorCarga(false)
    setPedidos(lista)
    setCargando(false)

    const ids = [...new Set(lista.flatMap((p) => p.items.map((i) => i.id)))]
    if (ids.length === 0) return
    const { data: productos } = await supabase
      .from('productos')
      .select('id, imagenes, imagen_url')
      .in('id', ids)
    const mapa: Record<string, string> = {}
    for (const prod of productos ?? []) mapa[prod.id] = portadaDe(prod)
    setImagenes(mapa)
    setExistentes(new Set((productos ?? []).map((prod) => prod.id)))
  }, [])

  useEffect(() => {
    if (!session) return
    const uid = session.user.id
    fetchPedidos(uid)
    void fetchMisResenas()
    const canal = supabase
      .channel(`mis-pedidos-${uid}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () =>
        fetchPedidos(uid),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
  }, [session, fetchPedidos, fetchMisResenas])

  // Requiere estar logueada.
  if (cargandoSesion) {
    return (
      <div className="catalog-root">
        <div className="loading-state">
          <span className="loading-spinner" aria-hidden="true" />
          Cargando…
        </div>
      </div>
    )
  }
  if (!session) return <Navigate to="/cuenta?next=/mis-pedidos" replace />

  const reintentar = () => {
    setCargando(true)
    fetchPedidos(session.user.id)
  }

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
        <h1 className="cart-title">Mis pedidos</h1>

        {cargando ? (
          <div className="loading-state">
            <span className="loading-spinner" aria-hidden="true" />
            Cargando tus pedidos…
          </div>
        ) : errorCarga && pedidos.length === 0 ? (
          <div className="load-error" role="alert">
            <p className="load-error-title">No pudimos cargar tus pedidos</p>
            <p className="load-error-text">
              Puede ser un problema de conexión. Tus pedidos están guardados: volvé a intentar.
            </p>
            <div className="load-error-actions">
              <button type="button" className="load-error-btn" onClick={reintentar}>
                Reintentar
              </button>
            </div>
          </div>
        ) : pedidos.length === 0 ? (
          <div className="no-results">
            Todavía no hiciste pedidos.
            <br />
            <Link className="pp-back" to="/">
              ← Ir al muestrario
            </Link>
          </div>
        ) : (
          <div className="mis-pedidos">
            {pedidos.map((p) => {
              const estado = estadoVisible(p)
              const est = ESTADO_CLIENTE[estado]
              const totales = totalesDe(p)
              const detalle = detalleDe(p)
              const desglose = lineasDesglose(totales, detalle)
              return (
                <div className={`mp-card ${est.clase}`} key={p.id}>
                  <div className="mp-top">
                    <div>
                      {/* El número va en segundo plano: sirve para nombrar el
                          pedido al escribir por WhatsApp (el mensaje del
                          checkout ya lo usa) o si hay dos el mismo día. */}
                      <span className="mp-num">
                        Pedido del {fecha(p.created_at)} <small>· N.º {p.numero}</small>
                      </span>
                    </div>
                    <span className={`mp-estado ${est.clase}`}>{est.texto}</span>
                  </div>
                  <div className="mp-items">
                    {p.items.map((i, idx) => {
                      const src = imagenes[i.id] ?? IMG_PLACEHOLDER
                      // Se ofrece calificar lo comprado por la web, no cancelado y
                      // que siga en el muestrario (la base exige lo mismo).
                      const calificable =
                        misResenas !== null &&
                        p.origen === 'checkout' &&
                        estado !== 'cancelado' &&
                        existentes.has(i.id)
                      const resena = misResenas?.get(i.id) ?? null
                      return (
                        <div className="mp-item" key={idx}>
                          <span className="mp-item-info">
                            <button
                              type="button"
                              className="mp-item-img-btn"
                              onClick={() => setZoomSrc(src)}
                              aria-label={`Ampliar foto de ${i.nombre}`}
                            >
                              <img className="mp-item-img" src={src} alt="" />
                            </button>
                            <span className="mp-item-texto">
                              <span>
                                {i.cantidad}x {i.nombre}
                              </span>
                              {calificable &&
                                (resena ? (
                                  <button
                                    type="button"
                                    className="mp-calificado"
                                    onClick={() => setCalificando({ id: i.id, nombre: i.nombre, imagen: src })}
                                    aria-label={`Tu reseña de ${i.nombre}: ${textoEstrellas(resena.estrellas)}. Editar`}
                                  >
                                    <Estrellas llenas={resena.estrellas} etiqueta={textoEstrellas(resena.estrellas)} />
                                    <span>Editar</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="mp-calificar"
                                    onClick={() => setCalificando({ id: i.id, nombre: i.nombre, imagen: src })}
                                  >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      <path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" />
                                    </svg>
                                    Calificar
                                  </button>
                                ))}
                            </span>
                          </span>
                          <span>{money(i.precio * i.cantidad)}</span>
                        </div>
                      )
                    })}
                    {/* Subtotal / descuento (con el cupón) / envío (con la zona)
                        solo si algo modifica el total o el envío salió gratis. */}
                    {desglose.length > 0 && (
                      <div className="mp-desglose">
                        {desglose.map((l) => (
                          <div className="mp-desglose-linea" key={l.concepto}>
                            <span>{l.etiqueta}</span>
                            <span>{l.texto ?? montoLinea(l.importe)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mp-item total">
                      <span>Total</span>
                      <strong>{money(totales.total)}</strong>
                    </div>
                  </div>
                  <div className="mp-entrega">
                    {p.entrega === 'envio' ? (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="mp-entrega-ic"
                        aria-hidden="true"
                      >
                        <path d="M21 8L12 3 3 8v8l9 5 9-5V8z" />
                        <path d="M3 8l9 5 9-5" />
                        <path d="M12 13v8" />
                      </svg>
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="mp-entrega-ic"
                        aria-hidden="true"
                      >
                        <path d="M6 8h12l-1 12H7L6 8z" />
                        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
                      </svg>
                    )}
                    {p.entrega === 'envio'
                      ? `Envío a ${p.direccion}, ${p.localidad} (CP ${p.cp})${p.provincia ? `, ${p.provincia}` : ''}`
                      : 'Retiro / a coordinar'}
                  </div>
                  {(p.seguimiento || (p.pagado_at && estado !== 'cancelado')) && (
                    <div className="mp-extra">
                      {p.pagado_at && estado !== 'cancelado' && <span className="mp-pagado">Pago recibido ✓</span>}
                      {p.seguimiento && (
                        <span>
                          Seguimiento:{' '}
                          {/^https?:\/\//.test(p.seguimiento) ? (
                            <a href={p.seguimiento} target="_blank" rel="noopener noreferrer">
                              ver el envío
                            </a>
                          ) : (
                            <strong className="mp-seguimiento">{p.seguimiento}</strong>
                          )}
                        </span>
                      )}
                    </div>
                  )}

                  {estado !== 'cancelado' && (
                    <button type="button" className="mp-comprobante" onClick={() => setComprobante(p)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 3v12" />
                        <path d="M7 10l5 5 5-5" />
                        <path d="M5 21h14" />
                      </svg>
                      Descargar comprobante
                    </button>
                  )}

                  {/* Un pedido cancelado siempre tiene una explicación del otro
                      lado: le damos a la clienta cómo pedirla. */}
                  {estado === 'cancelado' && (
                    <a
                      className="mp-consultar"
                      href={waConsultaCancelacionLink(p.numero, totales.total)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Consultar el motivo por WhatsApp
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* El estado vacío ya trae su propio link de vuelta — evitamos
            duplicarlo acá abajo. */}
        {!cargando && pedidos.length > 0 && (
          <Link className="pp-back" to="/">
            ← Volver al muestrario
          </Link>
        )}
      </main>

      {zoomSrc && <ImageZoom src={zoomSrc} alt="" onClose={() => setZoomSrc(null)} />}

      {calificando && (
        <CalificarProducto
          productoId={calificando.id}
          nombre={calificando.nombre}
          imagen={calificando.imagen}
          inicial={misResenas?.get(calificando.id) ?? null}
          onClose={() => setCalificando(null)}
          onGuardada={() => {
            setCalificando(null)
            invalidarResumenesResenas()
            void fetchMisResenas()
            notificar('¡Gracias! Tu reseña quedó guardada.')
          }}
        />
      )}

      {comprobante && (
        <Suspense fallback={null}>
          <OrderPrintView pedido={comprobante} tipo="comprobante" onClose={() => setComprobante(null)} />
        </Suspense>
      )}
    </div>
  )
}
