import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { money } from '../../lib/format'
import { etiquetaMes, porcentaje, type Rango } from '../../lib/estadisticas'
import { etiquetaCategoria } from '../../lib/gastos'
import { dominio, montoCompacto } from '../../lib/graficos'
import {
  MESES_PROYECCION,
  cargarRentabilidad,
  completarMesesRentabilidad,
  masRentable,
  masVendido,
  mejorMargen,
  ordenarPorBeneficio,
  sinDatosDeCosto,
  sinMovimiento,
  type Proyeccion,
  type Rentabilidad,
  type RentabilidadMes,
  type RentabilidadProducto,
} from '../../lib/rentabilidad'
import { useAncho } from '../../hooks/useAncho'

// Vista "Rentabilidad" de Estadísticas: ingresos vs. gastos vs. beneficio,
// estimación por producto y proyección simple. Los números salen de la RPC
// rentabilidad; las estimaciones, de funciones puras de lib/rentabilidad.

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string; faltaMigracion: boolean }
  | { tipo: 'listo'; datos: Rentabilidad; proyeccion: Proyeccion | null }

const numero = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 0 })

function pct(n: number | null): string {
  return n === null ? '—' : `${n.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`
}

export default function RentabilidadVista({ rango }: { rango: Rango }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' })
  const pedidoRef = useRef(0)

  const cargar = useCallback(async (r: Rango) => {
    const pedido = ++pedidoRef.current
    setEstado({ tipo: 'cargando' })
    const res = await cargarRentabilidad(r)
    // Si cambiaron el período mientras cargaba, esta respuesta ya no cuenta.
    if (pedido !== pedidoRef.current) return
    setEstado(
      res.ok
        ? { tipo: 'listo', datos: res.datos, proyeccion: res.proyeccion }
        : { tipo: 'error', mensaje: res.mensaje, faltaMigracion: res.faltaMigracion },
    )
  }, [])

  useEffect(() => {
    void cargar({ desde: rango.desde, hasta: rango.hasta })
  }, [rango.desde, rango.hasta, cargar])

  useEffect(
    () => () => {
      pedidoRef.current++
    },
    [],
  )

  if (estado.tipo === 'cargando') {
    return (
      <div className="est-cargando" role="status" aria-live="polite">
        <span className="est-spinner" aria-hidden="true" />
        Calculando rentabilidad…
      </div>
    )
  }
  if (estado.tipo === 'error') {
    return (
      <div className="est-error" role="alert">
        <p>{estado.mensaje}</p>
        {!estado.faltaMigracion && (
          <button type="button" className="est-btn" onClick={() => void cargar(rango)}>
            Reintentar
          </button>
        )}
      </div>
    )
  }
  return <Contenido datos={estado.datos} proyeccion={estado.proyeccion} rango={rango} />
}

function Contenido({
  datos,
  proyeccion,
  rango,
}: {
  datos: Rentabilidad
  proyeccion: Proyeccion | null
  rango: Rango
}) {
  const meses = useMemo(() => completarMesesRentabilidad(datos.por_mes, rango), [datos, rango])
  const { totales } = datos

  return (
    <div className="est-contenido">
      <dl className="est-kpis est-kpis--4">
        <Kpi etiqueta="Ingresos" valor={money(totales.ingresos)} destacado />
        <Kpi etiqueta="Gastos" valor={money(totales.gastos)} />
        <Kpi
          etiqueta="Beneficio"
          valor={money(totales.beneficio)}
          negativo={totales.beneficio < 0}
        />
        <Kpi etiqueta="Margen" valor={pct(totales.margen)} negativo={(totales.margen ?? 0) < 0} />
      </dl>

      {sinMovimiento(datos) ? (
        <>
          <p className="est-vacio">No hubo ventas ni gastos en este período.</p>
          {proyeccion && (
            <div className="est-grid est-grid--top">
              <article className="est-card">
                <h3 className="est-card-titulo">Estimación</h3>
                <TarjetaProyeccion proyeccion={proyeccion} />
              </article>
            </div>
          )}
        </>
      ) : (
        <div className="est-grid">
          <article className="est-card est-card--ancha">
            <h3 className="est-card-titulo">Ingresos, gastos y beneficio por mes</h3>
            <GraficoRentabilidad meses={meses} />
          </article>

          <article className="est-card est-card--ancha">
            <h3 className="est-card-titulo">Estimaciones</h3>
            <Estimaciones productos={datos.productos} proyeccion={proyeccion} />
          </article>

          <article className="est-card est-card--ancha">
            <h3 className="est-card-titulo">Por producto</h3>
            <TablaProductos productos={datos.productos} />
          </article>

          <article className="est-card">
            <h3 className="est-card-titulo">Gastos por categoría</h3>
            <GastosPorCategoria datos={datos} />
          </article>
        </div>
      )}
    </div>
  )
}

function Kpi({
  etiqueta,
  valor,
  destacado,
  negativo,
}: {
  etiqueta: string
  valor: string
  destacado?: boolean
  negativo?: boolean
}) {
  return (
    <div className={`est-kpi${destacado ? ' est-kpi--destacado' : ''}${negativo ? ' est-kpi--negativo' : ''}`}>
      <dt className="est-kpi-etiqueta">{etiqueta}</dt>
      <dd className="est-kpi-valor">{valor}</dd>
    </div>
  )
}

// ---- Gráfico: tres barras por mes, con el 0 en su lugar si hay pérdidas ------

const SERIES = [
  { clave: 'ingresos', nombre: 'Ingresos' },
  { clave: 'gastos', nombre: 'Gastos' },
  { clave: 'beneficio', nombre: 'Beneficio' },
] as const

function GraficoRentabilidad({ meses }: { meses: RentabilidadMes[] }) {
  const id = useId()
  const [ref, ancho] = useAncho<HTMLDivElement>(600)
  const alto = 240
  const margen = { arriba: 12, derecha: 8, abajo: 26, izquierda: 62 }
  const internoAncho = Math.max(ancho - margen.izquierda - margen.derecha, 40)
  const internoAlto = alto - margen.arriba - margen.abajo

  const { min, max } = dominio(meses.flatMap((m) => [m.ingresos, m.gastos, m.beneficio]))
  const y = (v: number) => ((max - v) / (max - min)) * internoAlto
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * (max - min))
  const paso = internoAncho / Math.max(meses.length, 1)
  const anchoGrupo = Math.min(paso * 0.78, 96)
  const anchoBarra = Math.max(anchoGrupo / 3 - 2, 2)
  const cadaK = Math.max(1, Math.ceil(meses.length / Math.max(1, Math.floor(internoAncho / 44))))

  const total = meses.reduce((s, m) => s + m.beneficio, 0)
  const descripcion =
    meses.length === 0
      ? 'Sin datos.'
      : `${meses.length} ${meses.length === 1 ? 'mes' : 'meses'}, de ${etiquetaMes(meses[0].mes, true)} a ${etiquetaMes(
          meses[meses.length - 1].mes,
          true,
        )}. Beneficio acumulado: ${money(total)}.`

  return (
    <>
      <ul className="est-leyenda" aria-hidden="true">
        {SERIES.map((s) => (
          <li key={s.clave}>
            <span className={`est-leyenda-punto est-serie--${s.clave}`} />
            {s.nombre}
          </li>
        ))}
      </ul>
      <div className="est-chart" ref={ref}>
        <svg width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-labelledby={`${id}-t ${id}-d`}>
          <title id={`${id}-t`}>Ingresos, gastos y beneficio por mes</title>
          <desc id={`${id}-d`}>{descripcion}</desc>
          <g transform={`translate(${margen.izquierda},${margen.arriba})`}>
            {ticks.map((t) => (
              <g key={t} aria-hidden="true">
                <line className="est-eje-linea" x1={0} x2={internoAncho} y1={y(t)} y2={y(t)} />
                <text className="est-eje-texto" x={-8} y={y(t)} dy="0.32em" textAnchor="end">
                  {montoCompacto.format(t)}
                </text>
              </g>
            ))}
            {min < 0 && <line className="est-eje-cero" x1={0} x2={internoAncho} y1={y(0)} y2={y(0)} aria-hidden="true" />}
            {meses.map((m, i) => {
              const x0 = i * paso + (paso - anchoGrupo) / 2
              return (
                <g key={m.mes}>
                  {SERIES.map((s, j) => {
                    const v = m[s.clave]
                    const top = Math.min(y(v), y(0))
                    const h = Math.abs(y(v) - y(0))
                    return (
                      <rect
                        key={s.clave}
                        className={`est-serie--${s.clave}${s.clave === 'beneficio' && v < 0 ? ' est-serie--perdida' : ''}`}
                        x={x0 + j * (anchoGrupo / 3) + 1}
                        y={top}
                        width={anchoBarra}
                        height={Math.max(h, v !== 0 ? 2 : 0)}
                        rx={Math.min(3, anchoBarra / 4)}
                      >
                        <title>{`${etiquetaMes(m.mes, true)} · ${s.nombre}: ${money(v)}`}</title>
                      </rect>
                    )
                  })}
                  {i % cadaK === 0 && (
                    <text
                      className="est-eje-texto"
                      x={i * paso + paso / 2}
                      y={internoAlto + 17}
                      textAnchor="middle"
                      aria-hidden="true"
                    >
                      {etiquetaMes(m.mes)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
      </div>
      <details className="est-tabla-wrap">
        <summary>Ver como tabla</summary>
        <div className="est-tabla-scroll">
          <table className="est-tabla">
            <caption className="est-sr">Ingresos, gastos y beneficio por mes</caption>
            <thead>
              <tr>
                <th scope="col">Mes</th>
                <th scope="col">Ingresos</th>
                <th scope="col">Gastos</th>
                <th scope="col">Beneficio</th>
                <th scope="col">Margen</th>
              </tr>
            </thead>
            <tbody>
              {meses.map((m) => (
                <tr key={m.mes}>
                  <th scope="row">{etiquetaMes(m.mes, true)}</th>
                  <td>{money(m.ingresos)}</td>
                  <td>{money(m.gastos)}</td>
                  <td className={m.beneficio < 0 ? 'est-negativo' : undefined}>{money(m.beneficio)}</td>
                  <td>{pct(m.margen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  )
}

// ---- Estimaciones ------------------------------------------------------------

function Estimaciones({
  productos,
  proyeccion,
}: {
  productos: RentabilidadProducto[]
  proyeccion: Proyeccion | null
}) {
  const vendido = masVendido(productos)
  const rentable = masRentable(productos)
  const margenAlto = mejorMargen(productos)
  const sinCosto = sinDatosDeCosto(productos)

  return (
    <>
      <div className="est-estimaciones">
        <Estimacion
          titulo="Más vendido"
          nombre={vendido?.nombre}
          detalle={vendido ? `${numero(vendido.unidades_vendidas)} u. · ${money(vendido.ingresos)}` : undefined}
          vacio="Sin ventas en el período."
        />
        <Estimacion
          titulo="Más rentable"
          nombre={rentable?.nombre}
          detalle={rentable ? `Deja ≈ ${money(rentable.beneficio_estimado ?? 0)}` : undefined}
          vacio="Faltan costos: cargá compras con producto y cantidad."
        />
        <Estimacion
          titulo="Mejor margen"
          nombre={margenAlto?.nombre}
          detalle={margenAlto ? `${pct(margenAlto.margen)} de cada venta` : undefined}
          vacio="Faltan costos: cargá compras con producto y cantidad."
        />
        <div className="est-estimacion">
          <p className="est-estimacion-titulo">Mes que viene</p>
          {proyeccion ? (
            <TarjetaProyeccion proyeccion={proyeccion} />
          ) : (
            <p className="est-estimacion-vacio">Todavía no hay meses completos con datos.</p>
          )}
        </div>
      </div>

      {sinCosto.length > 0 && (
        <p className="est-aviso">
          <strong>Sin datos de costo:</strong> {sinCosto.map((p) => p.nombre).join(', ')}. Cargá en
          “Gastos” una compra para ese producto con la cantidad de unidades que rinde.
        </p>
      )}

      <p className="est-nota">
        Cómo se calcula: el costo por unidad es el total de las compras cargadas para cada producto
        (con cantidad, hasta el fin del período) dividido por las unidades que rinden. Ventas brutas = precio × unidades, sin
        descuentos ni envíos; por eso su suma no coincide con los ingresos del período. Beneficio
        estimado = ventas brutas − costo por unidad × unidades vendidas. El mes que viene es el promedio
        de los últimos {MESES_PROYECCION} meses completos con movimiento. Son estimaciones, no
        números contables.
      </p>
    </>
  )
}

function Estimacion({
  titulo,
  nombre,
  detalle,
  vacio,
}: {
  titulo: string
  nombre?: string
  detalle?: string
  vacio: string
}) {
  return (
    <div className="est-estimacion">
      <p className="est-estimacion-titulo">{titulo}</p>
      {nombre ? (
        <>
          <p className="est-estimacion-nombre">{nombre}</p>
          {detalle && <p className="est-estimacion-detalle">{detalle}</p>}
        </>
      ) : (
        <p className="est-estimacion-vacio">{vacio}</p>
      )}
    </div>
  )
}

function TarjetaProyeccion({ proyeccion }: { proyeccion: Proyeccion }) {
  return (
    <>
      <p className="est-estimacion-nombre">Estimación para {etiquetaMes(proyeccion.mes, true)}</p>
      <dl className="est-proyeccion">
        <div>
          <dt>Ingresos</dt>
          <dd>{money(proyeccion.ingresos)}</dd>
        </div>
        <div>
          <dt>Gastos</dt>
          <dd>{money(proyeccion.gastos)}</dd>
        </div>
        <div>
          <dt>Beneficio</dt>
          <dd className={proyeccion.beneficio < 0 ? 'est-negativo' : undefined}>{money(proyeccion.beneficio)}</dd>
        </div>
      </dl>
      <p className="est-estimacion-detalle">
        Promedio de {proyeccion.mesesBase} {proyeccion.mesesBase === 1 ? 'mes completo' : 'meses completos'}.
      </p>
    </>
  )
}

// ---- Por producto ---------------------------------------------------------------

function TablaProductos({ productos }: { productos: RentabilidadProducto[] }) {
  const filas = useMemo(() => ordenarPorBeneficio(productos), [productos])
  if (filas.length === 0) return <p className="est-vacio est-vacio--chico">Sin productos vendidos.</p>
  return (
    <table className="est-tabla est-tabla--productos">
      <caption className="est-sr">Rentabilidad estimada por producto, ordenada por beneficio</caption>
      <thead>
        <tr>
          <th scope="col">Producto</th>
          <th scope="col">Vendidas</th>
          <th scope="col">Ventas brutas</th>
          <th scope="col">Costo x u.</th>
          <th scope="col">Beneficio est.</th>
          <th scope="col">Margen</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((p) => {
          const conCosto = p.costo_unitario_estimado !== null
          return (
            <tr key={p.producto_id} className={conCosto ? undefined : 'est-fila-sin-costo'}>
              <th scope="row">
                {p.nombre}
                {p.gastos_periodo > 0 && (
                  <span className="est-fila-sub">Compras del período: {money(p.gastos_periodo)}</span>
                )}
              </th>
              <td data-etiqueta="Vendidas">{numero(p.unidades_vendidas)}</td>
              <td data-etiqueta="Ventas brutas">{money(p.ingresos)}</td>
              <td data-etiqueta="Costo x u.">{conCosto ? money(p.costo_unitario_estimado ?? 0) : 'Sin datos'}</td>
              <td
                data-etiqueta="Beneficio est."
                className={(p.beneficio_estimado ?? 0) < 0 ? 'est-negativo' : undefined}
              >
                {p.beneficio_estimado === null ? '—' : money(p.beneficio_estimado)}
              </td>
              <td data-etiqueta="Margen">{pct(p.margen)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ---- Gastos por categoría ------------------------------------------------------------

function GastosPorCategoria({ datos }: { datos: Rentabilidad }) {
  const total = datos.totales.gastos
  if (!(total > 0)) return <p className="est-vacio est-vacio--chico">Sin gastos en el período.</p>
  const max = Math.max(...datos.gastos_por_categoria.map((c) => c.total), 1)
  return (
    <>
      <ul className="est-top est-top--categorias">
        {datos.gastos_por_categoria.map((c) => (
          <li className="est-top-item" key={c.categoria}>
            <div className="est-top-fila">
              <span className="est-top-nombre">{etiquetaCategoria(c.categoria)}</span>
              <span className="est-top-num">
                {money(c.total)} · {porcentaje(c.total, total)}%
              </span>
            </div>
            <div className="est-top-pista" aria-hidden="true">
              <div
                className="est-top-barra est-top-barra--gasto"
                style={{ width: `${c.total > 0 ? Math.max((c.total / max) * 100, 2) : 0}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="est-nota">
        Gastos generales (sin producto): <strong>{money(datos.gastos_generales)}</strong>
      </p>
    </>
  )
}
