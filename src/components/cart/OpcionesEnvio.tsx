import { useId } from 'react'
import {
  agruparOpciones,
  claveGrupo,
  etiquetaServicio,
  etiquetaSucursal,
  masEconomica,
  masRapida,
  textoPrecioOpcion,
  type OpcionEnvio,
  type SeleccionEnvio,
} from '../../lib/transportistas'
import { money } from '../../lib/format'

interface Props {
  opciones: readonly OpcionEnvio[]
  // Envío por zona (tarifa de la tienda) si hay una zona que cubre el destino.
  zona: { nombre: string | null; texto: string } | null
  seleccion: SeleccionEnvio
  onSeleccion: (s: SeleccionEnvio) => void
  deshabilitado?: boolean
}

// Opciones de envío del checkout (paso 2): la zona de la tienda (o "a
// coordinar" si no hay zona) y las de cada transportista. Es un grupo de
// radios; las opciones a sucursal traen un selector de sucursal abajo.
// La lógica (agrupado, precios, más barata / más rápida) vive en
// lib/transportistas; acá solo se dibuja.
export default function OpcionesEnvio({ opciones, zona, seleccion, onSeleccion, deshabilitado = false }: Props) {
  const id = useId()
  const grupos = agruparOpciones(opciones)
  const elegida =
    seleccion.tipo === 'transportista' ? opciones.find((o) => o.cotizacionId === seleccion.cotizacionId) ?? null : null
  const grupoElegido = elegida ? claveGrupo(elegida) : null
  // Destacados solo si hay con qué comparar.
  const conDestacados = grupos.length > 1
  const barata = conDestacados ? masEconomica(opciones) : null
  const rapida = conDestacados ? masRapida(opciones) : null

  return (
    <fieldset className="envio-opciones" disabled={deshabilitado}>
      <legend className="envio-opciones-titulo">¿Cómo te lo enviamos?</legend>

      {zona ? (
        <label className={seleccion.tipo === 'zona' ? 'envio-op active' : 'envio-op'}>
          <input
            type="radio"
            name={`${id}-envio`}
            checked={seleccion.tipo === 'zona'}
            onChange={() => onSeleccion({ tipo: 'zona' })}
          />
          <span className="envio-op-txt">
            <strong>Envío de la tienda</strong>
            {zona.nombre && <span>Zona {zona.nombre}</span>}
          </span>
          <span className="envio-op-precio">{zona.texto}</span>
        </label>
      ) : (
        <label className={seleccion.tipo === 'coordinar' ? 'envio-op active' : 'envio-op'}>
          <input
            type="radio"
            name={`${id}-envio`}
            checked={seleccion.tipo === 'coordinar'}
            onChange={() => onSeleccion({ tipo: 'coordinar' })}
          />
          <span className="envio-op-txt">
            <strong>Coordinar por WhatsApp</strong>
            <span>Te pasamos el costo al confirmar el pedido.</span>
          </span>
          <span className="envio-op-precio envio-op-precio--suave">A coordinar</span>
        </label>
      )}

      {grupos.map((g) => {
        const activo = grupoElegido === g.clave
        const plazo = g.opciones[0].plazo
        const esBarata = barata !== null && claveGrupo(barata) === g.clave
        const esRapida = rapida !== null && claveGrupo(rapida) === g.clave
        const idSucursal = `${id}-${g.clave}-sucursal`
        return (
          <div className={activo ? 'envio-op-bloque active' : 'envio-op-bloque'} key={g.clave}>
            <label className={activo ? 'envio-op active' : 'envio-op'}>
              <input
                type="radio"
                name={`${id}-envio`}
                checked={activo}
                onChange={() => {
                  // Al elegir el grupo, la opción más barata (o la sucursal ya elegida).
                  const op = g.opciones[0]
                  onSeleccion({ tipo: 'transportista', cotizacionId: op.cotizacionId })
                }}
              />
              <span className="envio-op-txt">
                <strong>{etiquetaServicio(g.transportista, g.servicio)}</strong>
                {(plazo || esBarata || esRapida) && (
                  <span>
                    {plazo && g.opciones.length === 1 ? plazo : null}
                    {esBarata && <em className="envio-badge">Más económico</em>}
                    {esRapida && <em className="envio-badge envio-badge--rapido">Más rápido</em>}
                  </span>
                )}
              </span>
              <span className="envio-op-precio">
                {g.precioVariable ? `desde ${money(g.precioDesde)}` : textoPrecioOpcion(g.precioDesde)}
              </span>
            </label>

            {activo && g.servicio === 'sucursal' && elegida && (
              <div className="envio-sucursal field">
                <label htmlFor={idSucursal}>Sucursal donde lo retirás</label>
                <select
                  id={idSucursal}
                  value={elegida.cotizacionId}
                  onChange={(e) => onSeleccion({ tipo: 'transportista', cotizacionId: e.target.value })}
                >
                  {g.opciones.map((o) =>
                    o.sucursal ? (
                      <option key={o.cotizacionId} value={o.cotizacionId}>
                        {etiquetaSucursal(o.sucursal)} · {textoPrecioOpcion(o.precio)}
                        {o.plazo ? ` · ${o.plazo}` : ''}
                      </option>
                    ) : null,
                  )}
                </select>
              </div>
            )}
          </div>
        )
      })}
    </fieldset>
  )
}
