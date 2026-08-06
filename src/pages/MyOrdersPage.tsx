import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import HeaderActions from '../components/account/HeaderActions'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { money } from '../lib/format'
import { waConsultaCancelacionLink } from '../lib/config'
import { IMG_PLACEHOLDER, portadaDe } from '../lib/images'
import type { EstadoPedido, Pedido } from '../types'
import '../styles/catalog.css'
import '../styles/account.css'

// Cómo se le muestra el estado a la clienta (más amable que el interno).
const ESTADO_CLIENTE: Record<EstadoPedido, { texto: string; clase: string }> = {
  nuevo: { texto: 'Pedido recibido', clase: 'e-nuevo' },
  confirmado: { texto: 'Confirmado · en preparación', clase: 'e-confirmado' },
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
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [cargando, setCargando] = useState(true)
  // Miniatura por producto (id -> url). El pedido solo guarda nombre/precio,
  // no imagen (foto "de época"), así que la traemos del producto actual —
  // igual que "por categoría" en las estadísticas, es una aproximación: si
  // el producto cambió de foto o se borró, se ve la portada actual o el
  // placeholder, no la que tenía el día de la compra.
  const [imagenes, setImagenes] = useState<Record<string, string>>({})

  const fetchPedidos = useCallback(async (uid: string) => {
    // Filtramos por user_id explícitamente. No alcanza con confiar en RLS: la
    // política permite leer "los propios O todos si sos admin", así que la
    // administradora vería acá los pedidos de todas las clientas como si fueran
    // suyos. "Mis pedidos" siempre son los de la cuenta logueada.
    const { data } = await supabase
      .from('pedidos')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
    const lista = (data ?? []) as Pedido[]
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
  }, [])

  useEffect(() => {
    if (!session) return
    const uid = session.user.id
    fetchPedidos(uid)
    const canal = supabase
      .channel('mis-pedidos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () =>
        fetchPedidos(uid),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
  }, [session, fetchPedidos])

  // Requiere estar logueada.
  if (cargandoSesion) return null
  if (!session) return <Navigate to="/cuenta?next=/mis-pedidos" replace />

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
              return (
                <div className="mp-card" key={p.id}>
                  <div className="mp-top">
                    <div>
                      {/* El número de pedido es un dato interno del admin
                          (lo usa para ubicarlo en el panel); a la clienta le
                          alcanza con la fecha para reconocer cuál es cuál. */}
                      <span className="mp-num">Pedido del {fecha(p.created_at)}</span>
                    </div>
                    <span className={`mp-estado ${est.clase}`}>{est.texto}</span>
                  </div>
                  <div className="mp-items">
                    {p.items.map((i, idx) => (
                      <div className="mp-item" key={idx}>
                        <span className="mp-item-info">
                          <img
                            className="mp-item-img"
                            src={imagenes[i.id] ?? IMG_PLACEHOLDER}
                            alt=""
                          />
                          {i.cantidad}x {i.nombre}
                        </span>
                        <span>{money(i.precio * i.cantidad)}</span>
                      </div>
                    ))}
                    <div className="mp-item total">
                      <span>Total</span>
                      <strong>{money(p.subtotal)}</strong>
                    </div>
                  </div>
                  <div className="mp-entrega">
                    {p.entrega === 'envio'
                      ? `Envío a ${p.direccion}, ${p.localidad} (CP ${p.cp})`
                      : 'Retiro / a coordinar'}
                  </div>

                  {/* Un pedido cancelado siempre tiene una explicación del otro
                      lado: le damos a la clienta cómo pedirla. */}
                  {estado === 'cancelado' && (
                    <a
                      className="mp-consultar"
                      href={waConsultaCancelacionLink(p.numero)}
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
    </div>
  )
}
