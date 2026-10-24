import { useEffect, useState } from 'react'
import type { ProductoConCategoria } from '../../types'
import type { ConteosPedidos, FiltroEstado } from '../../hooks/useOrders'
import { money } from '../../lib/format'
import { STOCK_BAJO } from '../../lib/stock'
import { cargarEstadisticas, rangoAnterior, rangoDePeriodo, variacion } from '../../lib/estadisticas'
// .est-cambio (la flecha ▲ ▼ con el porcentaje) es la misma de Estadísticas.
import '../../styles/estadisticas.css'

type FiltroStock = 'poco' | 'sin'

interface Props {
  nombre: string | null
  conteos: ConteosPedidos
  productos: ProductoConCategoria[]
  // Solo admin: ventas del mes (la RPC de estadísticas es solo para admin).
  verVentas: boolean
  onPedidos: (filtro: FiltroEstado) => void
  onProductos: (filtro: FiltroStock) => void
  onNuevoPedido: () => void
  onNuevoProducto: () => void
  onExportar: () => void
}

interface Tarea {
  clave: string
  cantidad: number
  titulo: string
  detalle: string
  tono: 'nuevo' | 'alerta' | 'info' | 'neutro'
  onClick: () => void
}

// Pantalla de inicio del panel: lo que hay que hacer hoy (cada fila lleva a
// la vista ya filtrada), las ventas del mes contra el mes anterior y accesos
// rápidos. Antes el panel abría directo en la lista de productos y lo urgente
// estaba repartido entre pestañas y chips.
export default function InicioPanel({
  nombre,
  conteos,
  productos,
  verVentas,
  onPedidos,
  onProductos,
  onNuevoPedido,
  onNuevoProducto,
  onExportar,
}: Props) {
  const sinStock = productos.filter((p) => p.stock <= 0).length
  const pocoStock = productos.filter((p) => p.stock > 0 && p.stock <= STOCK_BAJO).length
  const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios)

  const tareas: Tarea[] = [
    {
      clave: 'nuevo',
      cantidad: conteos.nuevo,
      titulo: plural(conteos.nuevo, 'Pedido nuevo para confirmar', 'Pedidos nuevos para confirmar'),
      detalle: 'Revisalos y avisale a la clienta',
      tono: 'nuevo',
      onClick: () => onPedidos('nuevo'),
    },
    {
      clave: 'sin-pagar',
      cantidad: conteos['sin-pagar'],
      titulo: plural(conteos['sin-pagar'], 'Pedido sin pagar', 'Pedidos sin pagar'),
      detalle: 'Marcalos como pagados cuando llegue el pago',
      tono: 'alerta',
      onClick: () => onPedidos('sin-pagar'),
    },
    {
      clave: 'confirmado',
      cantidad: conteos.confirmado,
      titulo: plural(conteos.confirmado, 'Pedido para preparar', 'Pedidos para preparar'),
      detalle: 'Confirmados, todavía sin enviar',
      tono: 'info',
      onClick: () => onPedidos('confirmado'),
    },
    {
      clave: 'sin-stock',
      cantidad: sinStock,
      titulo: plural(sinStock, 'Producto agotado', 'Productos agotados'),
      detalle: 'No se pueden comprar hasta que cargues stock',
      tono: 'neutro',
      onClick: () => onProductos('sin'),
    },
    {
      clave: 'poco-stock',
      cantidad: pocoStock,
      titulo: plural(pocoStock, 'Producto con la última unidad', 'Productos con la última unidad'),
      detalle: 'Conviene reponer',
      tono: 'neutro',
      onClick: () => onProductos('poco'),
    },
  ].filter((t) => t.cantidad > 0) as Tarea[]

  return (
    <section className="inicio" aria-labelledby="inicio-titulo">
      <h1 className="inicio-titulo" id="inicio-titulo">
        {nombre ? `Hola, ${nombre.split(' ')[0]}` : 'Hola'}
      </h1>

      <div className="inicio-card">
        <h2 className="inicio-subtitulo">Para hacer hoy</h2>
        {tareas.length === 0 ? (
          <p className="inicio-al-dia">Todo al día: no hay pedidos ni productos que necesiten atención.</p>
        ) : (
          <ul className="inicio-tareas">
            {tareas.map((t) => (
              <li key={t.clave}>
                <button type="button" className="inicio-tarea" onClick={t.onClick}>
                  <span className={`inicio-num inicio-num--${t.tono}`}>{t.cantidad}</span>
                  <span className="inicio-tarea-txt">
                    <strong>{t.titulo}</strong>
                    <span>{t.detalle}</span>
                  </span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {verVentas && <VentasDelMes />}

      <div className="inicio-accesos">
        <button type="button" onClick={onNuevoPedido}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Nuevo pedido
        </button>
        <button type="button" onClick={onNuevoProducto}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
          Cargar producto
        </button>
        <button type="button" onClick={onExportar}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="2.5" />
            <circle cx="6" cy="12" r="2.5" />
            <circle cx="18" cy="19" r="2.5" />
            <path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" />
          </svg>
          Lista de precios
        </button>
      </div>
    </section>
  )
}

// Ventas de este mes (al día de hoy) contra los mismos días del mes anterior.
// Si la consulta falla, la tarjeta no aparece: el resto del inicio sirve igual.
function VentasDelMes() {
  const [datos, setDatos] = useState<{ total: number; pedidos: number; cambio: number | null } | null>(null)

  useEffect(() => {
    let vigente = true
    const rango = rangoDePeriodo('este-mes', new Date())
    void Promise.all([cargarEstadisticas(rango), cargarEstadisticas(rangoAnterior(rango))]).then(([act, ant]) => {
      if (!vigente || !act.ok) return
      setDatos({
        total: act.datos.total_periodo,
        pedidos: act.datos.pedidos_periodo,
        cambio: ant.ok ? variacion(act.datos.total_periodo, ant.datos.total_periodo) : null,
      })
    })
    return () => {
      vigente = false
    }
  }, [])

  if (!datos) return null
  const mes = new Date().toLocaleDateString('es-AR', { month: 'long' })
  return (
    <div className="inicio-card inicio-ventas">
      <span className="inicio-ventas-etiqueta">Ventas de {mes}</span>
      <span className="inicio-ventas-valor">
        {money(datos.total)}
        {datos.cambio !== null && (
          <span className={`est-cambio ${datos.cambio > 0 ? 'sube' : datos.cambio < 0 ? 'baja' : 'igual'}`}>
            {datos.cambio > 0 ? '▲' : datos.cambio < 0 ? '▼' : '='} {Math.abs(datos.cambio)}%
          </span>
        )}
      </span>
      <span className="inicio-ventas-detalle">
        {datos.pedidos} {datos.pedidos === 1 ? 'pedido' : 'pedidos'} · comparado con los mismos días del mes pasado
      </span>
    </div>
  )
}
