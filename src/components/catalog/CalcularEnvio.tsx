import { useEffect, useId, useState } from 'react'
import type { ProductoConCategoria } from '../../types'
import { PROVINCIAS_AR } from '../../lib/orders'
import { cotizarEnvio } from '../../lib/envios'
import {
  armarPedidoCotizacion,
  consultarEstadoTransportistas,
  cotizarTransportistas,
  resumenEnvioFicha,
  textoPrecioOpcion,
  type LineaEnvioFicha,
} from '../../lib/transportistas'

// El último destino consultado queda en este dispositivo: al abrir otro
// producto ya aparece cargado.
const CLAVE_DESTINO = 'pecora-envio-destino'

function leerDestino(): { provincia: string; cp: string } {
  try {
    const d = JSON.parse(localStorage.getItem(CLAVE_DESTINO) ?? 'null')
    if (d && typeof d.provincia === 'string' && typeof d.cp === 'string') return d
  } catch {
    /* sin datos guardados */
  }
  return { provincia: '', cp: '' }
}

// ¿Hay algún transportista configurado? Se consulta una sola vez por visita
// (todas las fichas comparten la respuesta). Sin transportistas, el
// calculador no aparece: siempre diría "lo coordinamos por WhatsApp".
let hayTransportistas: Promise<boolean> | null = null
function consultarSiHayTransportistas(): Promise<boolean> {
  hayTransportistas ??= consultarEstadoTransportistas().then((r) => r.ok && r.activos.length > 0)
  return hayTransportistas
}

type Resultado =
  | { tipo: 'nada' }
  | { tipo: 'cotizando' }
  | { tipo: 'listo'; lineas: LineaEnvioFicha[] }

// "Calculá el envío" en la ficha: con provincia y código postal muestra las
// opciones de Andreani / Correo Argentino (o el envío por zona) para una
// unidad de este producto, antes de llegar al checkout. Usa las mismas
// cotizaciones que el checkout; el precio final se confirma ahí. Solo se
// muestra si hay transportistas configurados (Ajustes → Envíos).
export default function CalcularEnvio({ producto }: { producto: ProductoConCategoria }) {
  const id = useId()
  const [habilitado, setHabilitado] = useState(false)
  useEffect(() => {
    let vigente = true
    void consultarSiHayTransportistas().then((si) => {
      if (vigente) setHabilitado(si)
    })
    return () => {
      vigente = false
    }
  }, [])
  const [destino, setDestino] = useState(leerDestino)
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Resultado>({ tipo: 'nada' })

  async function calcular(e: React.FormEvent) {
    e.preventDefault()
    const pedido = armarPedidoCotizacion(destino.cp, destino.provincia, [{ id: producto.id, cantidad: 1 }])
    if (!pedido) {
      setError(destino.provincia ? 'Revisá el código postal (4 números).' : 'Elegí la provincia.')
      return
    }
    setError(null)
    setResultado({ tipo: 'cotizando' })
    try {
      localStorage.setItem(CLAVE_DESTINO, JSON.stringify(destino))
    } catch {
      /* sin persistencia */
    }
    const [transportistas, zona] = await Promise.all([
      cotizarTransportistas(pedido),
      cotizarEnvio(destino.provincia, destino.cp, producto.precio),
    ])
    setResultado({
      tipo: 'listo',
      lineas: resumenEnvioFicha(transportistas.ok ? transportistas.cotizacion.opciones : [], zona),
    })
  }

  if (!habilitado) return null

  return (
    <form className="calc-envio" onSubmit={calcular} noValidate aria-labelledby={`${id}-titulo`}>
      <p className="calc-envio-titulo" id={`${id}-titulo`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" />
          <circle cx="7" cy="18" r="1.8" />
          <circle cx="17.5" cy="18" r="1.8" />
        </svg>
        Calculá el envío
      </p>
      <div className="calc-envio-campos">
        <label className="sr-only" htmlFor={`${id}-prov`}>
          Provincia
        </label>
        <select
          id={`${id}-prov`}
          value={destino.provincia}
          onChange={(e) => setDestino((d) => ({ ...d, provincia: e.target.value }))}
        >
          <option value="">Provincia</option>
          {PROVINCIAS_AR.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`${id}-cp`}>
          Código postal
        </label>
        <input
          id={`${id}-cp`}
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="CP"
          maxLength={8}
          value={destino.cp}
          onChange={(e) => setDestino((d) => ({ ...d, cp: e.target.value }))}
        />
        <button type="submit" disabled={resultado.tipo === 'cotizando'}>
          {resultado.tipo === 'cotizando' ? 'Calculando…' : 'Calcular'}
        </button>
      </div>
      {error && (
        <p className="calc-envio-error" role="alert">
          {error}
        </p>
      )}
      <div aria-live="polite">
        {resultado.tipo === 'listo' && (
          <ul className="calc-envio-lista">
            {resultado.lineas.map((l) => (
              <li key={l.texto}>
                <span>{l.texto}</span>
                <strong>{textoPrecioOpcion(l.precio)}</strong>
              </li>
            ))}
            <li>
              <span>Retiro a coordinar</span>
              <strong className="calc-envio-gratis">Gratis</strong>
            </li>
            {resultado.lineas.length === 0 && (
              <li className="calc-envio-nota">Para tu zona, el envío lo coordinamos por WhatsApp al confirmar el pedido.</li>
            )}
          </ul>
        )}
      </div>
    </form>
  )
}
