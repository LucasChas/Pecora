import { useState } from 'react'
import { urlFeedMeta } from '../../lib/config'

// Ajustes → Instagram: el link del catálogo para Meta y cómo conectarlo.
export default function CatalogoInstagram() {
  const url = urlFeedMeta()
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      window.prompt('Copiá el link:', url)
    }
  }

  return (
    <section className="ig-feed">
      <h2>Catálogo para Instagram y Facebook</h2>
      <p>
        Este link tiene todos tus productos con foto, precio y stock (y cada talle por separado). Meta lo lee solo
        todos los días, así que no hay que cargar nada dos veces.
      </p>
      <div className="ig-feed-url">
        <code>{url}</code>
        <button type="button" className="head-action" onClick={() => void copiar()}>
          {copiado ? 'Copiado ✓' : 'Copiar link'}
        </button>
      </div>
      <ol>
        <li>
          Entrá a <strong>business.facebook.com/commerce</strong> (Administrador de comercio) con la cuenta de Facebook
          que maneja el Instagram de Pecora.
        </li>
        <li>
          Creá un catálogo de tipo <strong>Comercio electrónico</strong> → <strong>Agregar productos</strong> →{' '}
          <strong>Feed de datos</strong> → <strong>Feed programado</strong>.
        </li>
        <li>
          Pegá el link de arriba, elegí que se actualice <strong>todos los días</strong> y la moneda{' '}
          <strong>ARS</strong>.
        </li>
        <li>
          En Instagram: <strong>Configuración → Empresa → Configurar Instagram Shopping</strong> y elegí ese
          catálogo. Meta revisa la cuenta (puede tardar unos días).
        </li>
        <li>Listo: al publicar, tocá “Etiquetar productos” para marcar las prendas.</li>
      </ol>
    </section>
  )
}
