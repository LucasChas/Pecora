import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { money } from '../../lib/format'
import {
  PERIODOS,
  cargarEstadisticas,
  completarMeses,
  etiquetaMes,
  fechaISO,
  porcentaje,
  rangoDePeriodo,
  sinDatos,
  validarRango,
  type Estadisticas,
  type Periodo,
  type Rango,
  type VentaMes,
} from '../../lib/estadisticas'
import '../../styles/estadisticas.css'

// Pestaña "Estadísticas" del panel (solo admin). Todo sale de una sola RPC
// (estadisticas) para el rango elegido; ver lib/estadisticas.

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string; faltaMigracion: boolean }
  | { tipo: 'listo'; datos: Estadisticas }

const TOP = 10

const numero = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 0 })

function fechaCorta(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export default function EstadisticasPanel() {
  const [periodo, setPeriodo] = useState<Periodo>('este-mes')
  // Rango personalizado: lo que se está escribiendo y lo ya aplicado.
  const hoyISO = fechaISO(new Date())
  const [desdeInput, setDesdeInput] = useState(() => rangoDePeriodo('este-mes', new Date()).desde)
  const [hastaInput, setHastaInput] = useState(hoyISO)
  const [rangoPersonal, setRangoPersonal] = useState<Rango | null>(null)
  const [errorRango, setErrorRango] = useState<string | null>(null)

  const rango = useMemo<Rango | null>(
    () => (periodo === 'personalizado' ? rangoPersonal : rangoDePeriodo(periodo, new Date())),
    [periodo, rangoPersonal],
  )

  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' })
  const pedidoRef = useRef(0)

  const cargar = useCallback(async (r: Rango) => {
    const pedido = ++pedidoRef.current
    setEstado({ tipo: 'cargando' })
    const res = await cargarEstadisticas(r)
    // Si cambiaron el período mientras cargaba, esta respuesta ya no cuenta.
    if (pedido !== pedidoRef.current) return
    setEstado(
      res.ok
        ? { tipo: 'listo', datos: res.datos }
        : { tipo: 'error', mensaje: res.mensaje, faltaMigracion: res.faltaMigracion },
    )
  }, [])

  const desdeRango = rango?.desde
  const hastaRango = rango?.hasta
  useEffect(() => {
    if (desdeRango && hastaRango) void cargar({ desde: desdeRango, hasta: hastaRango })
  }, [desdeRango, hastaRango, cargar])

  useEffect(
    () => () => {
      // Al desmontar, invalida la respuesta pendiente.
      pedidoRef.current++
    },
    [],
  )

  const aplicarPersonalizado = (e: React.FormEvent) => {
    e.preventDefault()
    const err = validarRango(desdeInput, hastaInput)
    setErrorRango(err)
    if (!err) setRangoPersonal({ desde: desdeInput, hasta: hastaInput })
  }

  return (
    <section className="est-panel" aria-labelledby="est-titulo">
      <header className="est-head">
        <h2 className="est-titulo" id="est-titulo">
          Estadísticas
        </h2>
        {rango && (
          <p className="est-rango">
            {fechaCorta(rango.desde)} – {fechaCorta(rango.hasta)}
          </p>
        )}
      </header>

      <div className="est-periodos" role="radiogroup" aria-label="Período">
        {PERIODOS.map((p) => (
          <button
            key={p.valor}
            type="button"
            role="radio"
            aria-checked={periodo === p.valor}
            className={`est-periodo${periodo === p.valor ? ' est-periodo--activo' : ''}`}
            onClick={() => setPeriodo(p.valor)}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      {periodo === 'personalizado' && (
        <form className="est-custom" onSubmit={aplicarPersonalizado} noValidate>
          <label className="est-custom-campo">
            <span>Desde</span>
            <input
              type="date"
              value={desdeInput}
              max={hoyISO}
              onChange={(e) => setDesdeInput(e.target.value)}
            />
          </label>
          <label className="est-custom-campo">
            <span>Hasta</span>
            <input
              type="date"
              value={hastaInput}
              max={hoyISO}
              onChange={(e) => setHastaInput(e.target.value)}
            />
          </label>
          <button type="submit" className="est-btn">
            Ver
          </button>
          {errorRango && (
            <p className="est-custom-error" role="alert">
              {errorRango}
            </p>
          )}
        </form>
      )}

      {!rango ? (
        <p className="est-vacio">Elegí las fechas y tocá “Ver”.</p>
      ) : estado.tipo === 'cargando' ? (
        <div className="est-cargando" role="status" aria-live="polite">
          <span className="est-spinner" aria-hidden="true" />
          Calculando estadísticas…
        </div>
      ) : estado.tipo === 'error' ? (
        <div className="est-error" role="alert">
          <p>{estado.mensaje}</p>
          {!estado.faltaMigracion && (
            <button type="button" className="est-btn" onClick={() => void cargar(rango)}>
              Reintentar
            </button>
          )}
        </div>
      ) : (
        <Contenido datos={estado.datos} rango={rango} />
      )}
    </section>
  )
}

function Contenido({ datos, rango }: { datos: Estadisticas; rango: Rango }) {
  const meses = useMemo(() => completarMeses(datos.ventas_por_mes, rango), [datos, rango])

  return (
    <div className="est-contenido">
      <dl className="est-kpis">
        <Kpi etiqueta="Ventas del período" valor={money(datos.total_periodo)} destacado />
        <Kpi etiqueta="Pedidos" valor={numero(datos.pedidos_periodo)} />
        <Kpi etiqueta="Ticket promedio" valor={money(datos.ticket_promedio)} />
        <Kpi etiqueta="Clientas nuevas" valor={numero(datos.clientas_nuevas)} />
        <Kpi etiqueta="Clientas que compraron" valor={numero(datos.clientas_con_compra)} />
      </dl>

      {sinDatos(datos) ? (
        <p className="est-vacio">No hubo ventas en este período.</p>
      ) : (
        <div className="est-grid">
          <article className="est-card est-card--ancha">
            <h3 className="est-card-titulo">Ventas por mes</h3>
            <GraficoMeses meses={meses} />
          </article>

          <article className="est-card">
            <h3 className="est-card-titulo">Lo más vendido</h3>
            <TopVendidos datos={datos} />
          </article>

          <article className="est-card">
            <h3 className="est-card-titulo">Web vs. manual</h3>
            <PorOrigen datos={datos} />
          </article>
        </div>
      )}
    </div>
  )
}

function Kpi({ etiqueta, valor, destacado }: { etiqueta: string; valor: string; destacado?: boolean }) {
  return (
    <div className={`est-kpi${destacado ? ' est-kpi--destacado' : ''}`}>
      <dt className="est-kpi-etiqueta">{etiqueta}</dt>
      <dd className="est-kpi-valor">{valor}</dd>
    </div>
  )
}

// ---- Gráfico de barras (SVG a medida del contenedor) ----------------------

const compacto = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  notation: 'compact',
  maximumFractionDigits: 1,
})

// Techo "redondo" para el eje (1, 2, 2.5, 5 × 10^n).
function techo(max: number): number {
  if (!(max > 0)) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(max)))
  for (const f of [1, 2, 2.5, 5, 10]) {
    if (f * exp >= max) return f * exp
  }
  return 10 * exp
}

function useAncho<T extends HTMLElement>(inicial: number) {
  const ref = useRef<T>(null)
  const [ancho, setAncho] = useState(inicial)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const medir = () => {
      const w = Math.round(el.getBoundingClientRect().width)
      if (w > 0) setAncho(w)
    }
    medir()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, ancho] as const
}

function GraficoMeses({ meses }: { meses: VentaMes[] }) {
  const id = useId()
  const [ref, ancho] = useAncho<HTMLDivElement>(600)
  const alto = 220
  const margen = { arriba: 12, derecha: 8, abajo: 26, izquierda: 58 }
  const internoAncho = Math.max(ancho - margen.izquierda - margen.derecha, 40)
  const internoAlto = alto - margen.arriba - margen.abajo

  const max = techo(Math.max(0, ...meses.map((m) => m.total)))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
  const paso = internoAncho / Math.max(meses.length, 1)
  const anchoBarra = Math.min(Math.max(paso * 0.62, 4), 56)
  // Con muchos meses no entran todas las etiquetas: se muestra una cada k.
  const cadaK = Math.max(1, Math.ceil(meses.length / Math.max(1, Math.floor(internoAncho / 44))))

  const mejor = meses.reduce<VentaMes | null>((a, m) => (!a || m.total > a.total ? m : a), null)
  const descripcion =
    meses.length === 0
      ? 'Sin datos.'
      : `${meses.length} ${meses.length === 1 ? 'mes' : 'meses'}, de ${etiquetaMes(meses[0].mes, true)} a ${etiquetaMes(
          meses[meses.length - 1].mes,
          true,
        )}.` + (mejor && mejor.total > 0 ? ` Mes con más ventas: ${etiquetaMes(mejor.mes, true)} (${money(mejor.total)}).` : '')

  return (
    <>
      <div className="est-chart" ref={ref}>
        <svg
          width={ancho}
          height={alto}
          viewBox={`0 0 ${ancho} ${alto}`}
          role="img"
          aria-labelledby={`${id}-t ${id}-d`}
        >
          <title id={`${id}-t`}>Ventas por mes</title>
          <desc id={`${id}-d`}>{descripcion}</desc>
          <g transform={`translate(${margen.izquierda},${margen.arriba})`}>
            {ticks.map((t) => {
              const y = internoAlto - (t / max) * internoAlto
              return (
                <g key={t} aria-hidden="true">
                  <line className="est-eje-linea" x1={0} x2={internoAncho} y1={y} y2={y} />
                  <text className="est-eje-texto" x={-8} y={y} dy="0.32em" textAnchor="end">
                    {compacto.format(t)}
                  </text>
                </g>
              )
            })}
            {meses.map((m, i) => {
              const h = (m.total / max) * internoAlto
              const x = i * paso + (paso - anchoBarra) / 2
              return (
                <g key={m.mes}>
                  <rect
                    className="est-barra"
                    x={x}
                    y={internoAlto - h}
                    width={anchoBarra}
                    height={Math.max(h, m.total > 0 ? 2 : 0)}
                    rx={Math.min(4, anchoBarra / 4)}
                  >
                    <title>{`${etiquetaMes(m.mes, true)}: ${money(m.total)} · ${m.pedidos} ${
                      m.pedidos === 1 ? 'pedido' : 'pedidos'
                    }`}</title>
                  </rect>
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
        <table className="est-tabla">
          <caption className="est-sr">Ventas por mes</caption>
          <thead>
            <tr>
              <th scope="col">Mes</th>
              <th scope="col">Pedidos</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {meses.map((m) => (
              <tr key={m.mes}>
                <th scope="row">{etiquetaMes(m.mes, true)}</th>
                <td>{numero(m.pedidos)}</td>
                <td>{money(m.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  )
}

// ---- Top vendidos ----------------------------------------------------------

function TopVendidos({ datos }: { datos: Estadisticas }) {
  const top = datos.mas_vendidos.slice(0, TOP)
  if (top.length === 0) return <p className="est-vacio est-vacio--chico">Sin productos vendidos.</p>
  const max = Math.max(...top.map((p) => p.unidades), 1)
  return (
    <ol className="est-top">
      {top.map((p) => (
        <li className="est-top-item" key={p.producto_id}>
          <div className="est-top-fila">
            <span className="est-top-nombre">{p.nombre}</span>
            <span className="est-top-num">
              {numero(p.unidades)} u. · {money(p.importe)}
            </span>
          </div>
          <div className="est-top-pista" aria-hidden="true">
            <div className="est-top-barra" style={{ width: `${Math.max((p.unidades / max) * 100, 2)}%` }} />
          </div>
        </li>
      ))}
    </ol>
  )
}

// ---- Web vs. manual --------------------------------------------------------

function PorOrigen({ datos }: { datos: Estadisticas }) {
  const { checkout, admin } = datos.por_origen
  const total = checkout.total + admin.total
  const pctWeb = porcentaje(checkout.total, total)
  const pctManual = total > 0 ? 100 - pctWeb : 0
  const filas = [
    { clave: 'web', nombre: 'Tienda web', d: checkout, pct: pctWeb },
    { clave: 'manual', nombre: 'Cargados a mano', d: admin, pct: pctManual },
  ]
  return (
    <div className="est-origen">
      <div
        className="est-origen-barra"
        role="img"
        aria-label={`Tienda web ${pctWeb}% del total, cargados a mano ${pctManual}%`}
      >
        {total > 0 ? (
          <>
            <span className="est-origen-seg est-origen-seg--web" style={{ width: `${pctWeb}%` }} />
            <span className="est-origen-seg est-origen-seg--manual" style={{ width: `${pctManual}%` }} />
          </>
        ) : null}
      </div>
      <ul className="est-origen-leyenda">
        {filas.map((f) => (
          <li key={f.clave} className="est-origen-item">
            <span className={`est-origen-punto est-origen-punto--${f.clave}`} aria-hidden="true" />
            <span className="est-origen-nombre">{f.nombre}</span>
            <span className="est-origen-dato">
              {money(f.d.total)} · {numero(f.d.pedidos)} {f.d.pedidos === 1 ? 'pedido' : 'pedidos'} ·{' '}
              <strong>{f.pct}%</strong>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
