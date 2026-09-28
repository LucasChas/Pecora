import { useEffect, useState } from 'react'
import type { Pedido } from '../../types'
import OrderCard, { GRACIA_MAILS_MS, mailsPendientes } from './OrderCard'

interface Props {
  pedidos: Pedido[]
  loading: boolean
  error: string | null
  onChanged: () => void
  hayMas: boolean
  onVerMas: () => void
  // Si hay filtro o búsqueda activos, el mensaje de "vacío" es distinto.
  filtrando: boolean
  papelera: boolean
}

// Lista de pedidos del panel. Contempla el estado de carga, error (típico si
// falta correr la migración 0003) y vacío.
export default function OrdersList({
  pedidos,
  loading,
  error,
  onChanged,
  hayMas,
  onVerMas,
  filtrando,
  papelera,
}: Props) {
  // Aviso de mails sin enviar: se descarta para el conjunto de pedidos que había
  // al cerrarlo; si aparece otro pedido con el mismo problema, vuelve.
  const [avisoDescartado, setAvisoDescartado] = useState('')
  const [, setReloj] = useState(0)
  const ahora = Date.now()

  // Un pedido recién creado todavía no tiene las marcas de "mail enviado": el
  // aviso recién corresponde pasados unos minutos. Se vuelve a dibujar en ese
  // momento (si no, esperaría al próximo cambio de la lista).
  useEffect(() => {
    const desde = Date.now()
    let proximo = Infinity
    for (const p of pedidos) {
      if (p.origen !== 'checkout') continue
      if (p.email_enviado_at !== null && p.aviso_duena_enviado_at !== null) continue
      const vence = Date.parse(p.created_at) + GRACIA_MAILS_MS
      if (vence > desde && vence < proximo) proximo = vence
    }
    if (proximo === Infinity) return
    const t = window.setTimeout(() => setReloj((n) => n + 1), proximo - desde + 1000)
    return () => window.clearTimeout(t)
  }, [pedidos])

  if (error) {
    return (
      <div className="list">
        <div className="empty">
          No pudimos cargar los pedidos.
          <br />
          {error.includes('pedidos') || error.includes('schema') ? (
            <>Falta correr la migración <code>0003_pedidos.sql</code> en Supabase.</>
          ) : (
            error
          )}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="list">
        <div className="empty">Cargando pedidos…</div>
      </div>
    )
  }

  if (pedidos.length === 0) {
    return (
      <div className="list">
        <div className="empty">
          {papelera ? (
            <>
              La papelera está vacía.
              <br />
              Los pedidos que borres van a parar acá y podés recuperarlos.
            </>
          ) : filtrando ? (
            <>
              Ningún pedido coincide con la búsqueda.
              <br />
              Probá con otro nombre, teléfono o número.
            </>
          ) : (
            <>
              Todavía no hay pedidos.
              <br />
              Cuando una clienta finalice una compra en el muestrario, aparece acá.
            </>
          )}
        </div>
      </div>
    )
  }

  // Pedidos web de los últimos días con algún mail sin salir (ver mailsPendientes).
  const conMailsPendientes = pedidos
    .filter((p) => mailsPendientes(p, ahora) !== null)
    .map((p) => p.id)
    .sort()
    .join(',')
  const mostrarAviso = conMailsPendientes !== '' && conMailsPendientes !== avisoDescartado

  return (
    <div className="list list--pedidos">
      {mostrarAviso && (
        <div className="orders-aviso-mails" role="status">
          <p>
            Hay pedidos con mails sin enviar. Revisá la configuración de Gmail o reenviá desde cada
            pedido.
          </p>
          <button
            type="button"
            className="orders-aviso-cerrar"
            aria-label="Cerrar aviso"
            onClick={() => setAvisoDescartado(conMailsPendientes)}
          >
            ×
          </button>
        </div>
      )}
      {pedidos.map((p) => (
        <OrderCard key={p.id} pedido={p} onChanged={onChanged} ahora={ahora} />
      ))}
      {hayMas && (
        <button type="button" className="orders-mas" onClick={onVerMas}>
          Ver más pedidos
        </button>
      )}
    </div>
  )
}
