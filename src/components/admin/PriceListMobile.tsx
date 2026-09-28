import type { GrupoLista } from '../../lib/catalogExport'
import { portadaDe } from '../../lib/images'
import Logo from '../Logo'
import { PriceListCard } from './PriceListBand'
import { Festoneado } from './PriceListPage'

interface Props {
  // Las mismas categorías, en el mismo orden, que las hojas A4
  // (agruparPorCategoria, sin armar bandas).
  grupos: GrupoLista[]
  mesAnio: string
  sitio: string
  // Las mismas miniaturas que las hojas (blob:): no se baja nada de nuevo.
  // Sin esto (mientras se preparan) va el cuadrado vacío.
  fotos?: ReadonlyMap<string, string>
}

// Lista de precios para leer en el celular: el contenido de las hojas A4
// reacomodado en 2 o 3 columnas con letra legible, con el mismo header,
// festón, cards y pie de la plantilla. Solo pantalla: al imprimir siempre
// salen las hojas A4 (ver catalog-export.css). Presentacional.
export default function PriceListMobile({ grupos, mesAnio, sitio, fotos }: Props) {
  return (
    <div className="ce-lista">
      <header className="ce-lista-header">
        <Logo className="ce-lista-logo" />
        <div className="ce-lista-marca">
          <p className="ce-lista-tag">Lista de precios</p>
          <p className="ce-lista-mes">{mesAnio}</p>
        </div>
      </header>

      <Festoneado natural />

      <div className="ce-lista-main">
        {grupos.map((grupo) => (
          <section key={grupo.clave} className="ce-lista-grp">
            <h2 className="ce-lista-titulo">{grupo.titulo}</h2>
            <div className="ce-lista-cards">
              {grupo.productos.map((p) => (
                <PriceListCard key={p.id} producto={p} foto={fotos?.get(portadaDe(p))} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <footer className="ce-lista-footer">
        <span>Precios vigentes · {mesAnio} · Medidas aproximadas</span>
        <span>
          Ver fotos y hacer pedidos: <b>{sitio}</b>
        </span>
      </footer>
    </div>
  )
}
