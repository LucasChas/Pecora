import { useState } from 'react'
import CuponesAdmin from './CuponesAdmin'
import ZonasEnvioAdmin from './ZonasEnvioAdmin'
import ImportarProductos from './ImportarProductos'
import EquipoAdmin from './EquipoAdmin'
import ResenasAdmin from './ResenasAdmin'
import CatalogoInstagram from './CatalogoInstagram'

type Seccion = 'cupones' | 'zonas' | 'importar' | 'resenas' | 'instagram' | 'equipo'

const SECCIONES: { valor: Seccion; texto: string }[] = [
  { valor: 'cupones', texto: 'Cupones' },
  { valor: 'zonas', texto: 'Zonas de envío' },
  { valor: 'importar', texto: 'Importar productos' },
  { valor: 'resenas', texto: 'Reseñas' },
  { valor: 'instagram', texto: 'Instagram' },
  { valor: 'equipo', texto: 'Equipo' },
]

interface Props {
  // Tras una carga masiva, para refrescar productos y categorías del panel.
  onProductosImportados?: () => void
}

// Pestaña "Ajustes" del panel (solo admin): cupones, zonas de envío, carga
// masiva de productos, moderación de reseñas y equipo.
export default function AjustesPanel({ onProductosImportados }: Props) {
  const [seccion, setSeccion] = useState<Seccion>('cupones')

  return (
    <>
      <div className="list-head">
        <div>
          <h1>Ajustes</h1>
          <p>Cupones, envíos, carga masiva de productos, reseñas y equipo del panel.</p>
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

      {seccion === 'cupones' ? (
        <CuponesAdmin />
      ) : seccion === 'zonas' ? (
        <ZonasEnvioAdmin />
      ) : seccion === 'importar' ? (
        <ImportarProductos onImportado={onProductosImportados} />
      ) : seccion === 'resenas' ? (
        <ResenasAdmin />
      ) : seccion === 'instagram' ? (
        <CatalogoInstagram />
      ) : (
        <EquipoAdmin />
      )}
    </>
  )
}
