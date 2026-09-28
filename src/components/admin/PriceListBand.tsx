import { useState } from 'react'
import type { ProductoConCategoria } from '../../types'
import { money } from '../../lib/format'
import { portadaDe } from '../../lib/images'
import {
  LADO_MINIATURA,
  PREFIJO_LOG,
  productosDelTramo,
  type Banda,
} from '../../lib/catalogExport'

interface Props {
  bloques: Banda
  // Tramo de filas [desde, hasta) cuando una categoría larga se parte entre hojas.
  filas?: [number, number] | null
  // Es la continuación de una categoría que empezó en la hoja anterior.
  continuacion?: boolean
  // Miniaturas ya preparadas: portada original -> miniatura local (blob:).
  // Sin esto (pasada de medición, o mientras se preparan) y para las fotos
  // que no se pudieron preparar va el cuadrado vacío: mide igual.
  fotos?: ReadonlyMap<string, string>
}

// Una banda de la lista de precios: grilla de 5 columnas con una o varias
// categorías (título + cards). Presentacional.
export default function PriceListBand({
  bloques,
  filas = null,
  continuacion = false,
  fotos,
}: Props) {
  return (
    <div className="ce-band">
      {bloques.map(({ grupo, columnas }) => (
        <section key={grupo.clave} className="ce-grp" style={{ gridColumn: `span ${columnas}` }}>
          <h2 className="ce-grp-title">
            {grupo.titulo}
            {continuacion && ' (cont.)'}
          </h2>
          <div
            className="ce-cards"
            style={{ gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))` }}
          >
            {productosDelTramo(grupo, filas).map((p) => (
              <PriceListCard key={p.id} producto={p} foto={fotos?.get(portadaDe(p))} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

// Card: foto cuadrada (miniatura de la portada), nombre y precio. Mismo precio
// y mismo criterio de stock que la card del muestrario. Si no hay foto (o no
// carga), va un cuadrado con los colores de la plantilla. También la usa la
// lista del celular (PriceListMobile), que agranda la letra desde el CSS.
export function PriceListCard({
  producto,
  foto,
}: {
  producto: ProductoConCategoria
  foto?: string
}) {
  // Se guarda qué foto falló (no un sí/no) para que una miniatura nueva se intente.
  const [fallida, setFallida] = useState<string | null>(null)
  const conFoto = foto !== undefined && foto !== fallida
  const disponible = producto.stock > 0

  return (
    <figure className={disponible ? 'ce-card' : 'ce-card ce-card--agotado'}>
      <div className="ce-ph">
        {conFoto ? (
          <img
            className="ce-img"
            src={foto}
            alt=""
            width={LADO_MINIATURA}
            height={LADO_MINIATURA}
            decoding="async"
            onError={() => {
              console.warn(`${PREFIJO_LOG} No se pudo mostrar la foto de "${producto.nombre}".`)
              setFallida(foto ?? null)
            }}
          />
        ) : (
          <div className="ce-img ce-img--vacia" aria-hidden="true">
            Pecora
          </div>
        )}
        {!disponible && <span className="ce-badge">Sin stock</span>}
      </div>
      <figcaption className="ce-cap">
        <span className="ce-nm">{producto.nombre}</span>
        <span className="ce-pr">{money(producto.precio)}</span>
      </figcaption>
    </figure>
  )
}
