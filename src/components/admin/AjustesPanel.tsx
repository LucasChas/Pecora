import { useState } from 'react'
import CuponesAdmin from './CuponesAdmin'
import ZonasEnvioAdmin from './ZonasEnvioAdmin'

type Seccion = 'cupones' | 'zonas'

const SECCIONES: { valor: Seccion; texto: string }[] = [
  { valor: 'cupones', texto: 'Cupones' },
  { valor: 'zonas', texto: 'Zonas de envío' },
]

// Pestaña "Ajustes" del panel: cupones de descuento y zonas de envío.
export default function AjustesPanel() {
  const [seccion, setSeccion] = useState<Seccion>('cupones')

  return (
    <>
      <div className="list-head">
        <div>
          <h1>Ajustes</h1>
          <p>Cupones de descuento y costo del envío por zona.</p>
        </div>
      </div>

      <div className="orders-tools">
        <div className="orders-chips" role="group" aria-label="Sección de ajustes">
          {SECCIONES.map((s) => (
            <button
              key={s.valor}
              type="button"
              className={seccion === s.valor ? 'chip active' : 'chip'}
              aria-pressed={seccion === s.valor}
              onClick={() => setSeccion(s.valor)}
            >
              {s.texto}
            </button>
          ))}
        </div>
      </div>

      {seccion === 'cupones' ? <CuponesAdmin /> : <ZonasEnvioAdmin />}
    </>
  )
}
