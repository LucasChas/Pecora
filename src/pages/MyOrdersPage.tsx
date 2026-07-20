import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import HeaderActions from '../components/account/HeaderActions'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { money } from '../lib/format'
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

function fecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// "Mis pedidos" (/mis-pedidos): historial de la clienta con el estado en vivo.
// Cuando la admin cambia el estado de un pedido, acá se actualiza solo (Realtime).
export default function MyOrdersPage() {
  const { session, loading: cargandoSesion } = useAuth()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [cargando, setCargando] = useState(true)

  const fetchPedidos = useCallback(async () => {
    // RLS garantiza que solo trae los pedidos de la clienta logueada.
    const { data } = await supabase.from('pedidos').select('*').order('created_at', { ascending: false })
    setPedidos((data ?? []) as Pedido[])
    setCargando(false)
  }, [])

  useEffect(() => {
    if (!session) return
    fetchPedidos()
    const canal = supabase
      .channel('mis-pedidos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, fetchPedidos)
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

      <main className="account">
        <h1 className="cart-title">Mis pedidos</h1>

        {cargando ? (
          <p className="no-results">Cargando tus pedidos…</p>
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
              const est = ESTADO_CLIENTE[p.estado]
              return (
                <div className="mp-card" key={p.id}>
                  <div className="mp-top">
                    <div>
                      <span className="mp-num">Pedido #{p.numero}</span>
                      <span className="mp-fecha">{fecha(p.created_at)}</span>
                    </div>
                    <span className={`mp-estado ${est.clase}`}>{est.texto}</span>
                  </div>
                  <div className="mp-items">
                    {p.items.map((i, idx) => (
                      <div className="mp-item" key={idx}>
                        <span>
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
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
