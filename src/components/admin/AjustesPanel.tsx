import { useState } from 'react'
import CuponesAdmin from './CuponesAdmin'
import ZonasEnvioAdmin from './ZonasEnvioAdmin'
import ImportarProductos from './ImportarProductos'
import EquipoAdmin from './EquipoAdmin'
import ResenasAdmin from './ResenasAdmin'
import CatalogoInstagram from './CatalogoInstagram'
import CategoriasAdmin from './CategoriasAdmin'
import type { Categoria, ProductoConCategoria } from '../../types'

export type Seccion = 'categorias' | 'cupones' | 'zonas' | 'importar' | 'resenas' | 'instagram' | 'equipo'

const SECCIONES: { valor: Seccion; texto: string }[] = [
  { valor: 'categorias', texto: 'Categorías' },
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
  // Para la sección Categorías (cantidad de productos por categoría).
  categorias: Categoria[]
  productos: ProductoConCategoria[]
  // Refresca productos y categorías tras crear, renombrar o eliminar.
  onCategoriasCambiadas: () => void
  // Sección con la que se abre (ej. desde el formulario de producto).
  seccionInicial?: Seccion
}

// Pestaña "Ajustes" del panel (solo admin): categorías, cupones, zonas de envío, carga
// masiva de productos, moderación de reseñas y equipo.
export default function AjustesPanel({
  onProductosImportados,
  categorias,
  productos,
  onCategoriasCambiadas,
  seccionInicial = 'categorias',
}: Props) {
  const [seccion, setSeccion] = useState<Seccion>(seccionInicial)

  return (
    <>
      <div className="list-head">
        <div>
          <h1>Ajustes</h1>
          <p>Categorías, cupones, envíos, carga masiva de productos, reseñas y equipo del panel.</p>
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

      {seccion === 'categorias' ? (
        <CategoriasAdmin categorias={categorias} productos={productos} onChanged={onCategoriasCambiadas} />
      ) : seccion === 'cupones' ? (
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
