import { describe, expect, it } from 'vitest'
import {
  DESCRIPCION_GENERICA,
  MAX_DESCRIPCION,
  MAX_TITULO,
  SITIO_POR_DEFECTO,
  TITULO_GENERICO,
  consultaDeParam,
  descripcionProducto,
  escaparHtml,
  htmlDeMeta,
  htmlDeRespaldo,
  imagenAbsoluta,
  imagenProducto,
  inyectarMeta,
  metaGenerica,
  metaProducto,
  precioArs,
  truncar,
  urlDelSitio,
  type MetaOg,
  type ProductoOg,
} from './ogProducto'

const SITIO = 'https://pecora-muestrario.vercel.app'
const FOTO = 'https://abc.supabase.co/storage/v1/object/public/productos/foto.jpg'
// Intl separa "$" del número con un espacio duro; se normaliza para no
// depender de la versión de ICU.
const plano = (s: string) => s.replace(/\s/g, ' ')

const producto = (extra: Partial<ProductoOg> = {}): ProductoOg => ({
  id: '3f2a1b4c-1111-2222-3333-444455556666',
  slug: 'babero-rayado',
  nombre: 'Babero rayado',
  descripcion: 'Babero de algodón con broche.',
  precio: 12500,
  imagen_url: FOTO,
  imagenes: [FOTO],
  ...extra,
})

const valor = (meta: MetaOg, clave: string) => meta.tags.find((t) => t.clave === clave)?.valor

// index.html como lo deja Vite (formato multilínea de las meta incluido).
const INDEX = `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pecora · Accesorios textiles para bebés</title>
    <meta
      name="description"
      content="Genérica"
    />
    <meta name="theme-color" content="#F8F1E1" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Pecora · Accesorios textiles para bebés" />
    <meta property="og:url" content="${SITIO}/" />
    <meta property="og:image" content="${SITIO}/og-image.jpg" />
    <meta property="og:image:width" content="1200" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="module" crossorigin src="/assets/index-abc123.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-abc123.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`

describe('escaparHtml', () => {
  it('escapa los cinco caracteres especiales', () => {
    expect(escaparHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    )
  })

  it('no deja cerrar un atributo ni abrir un script', () => {
    const malicioso = `"><script>alert(1)</script><meta x="`
    const salida = escaparHtml(malicioso)
    expect(salida).not.toMatch(/[<>"]/)
  })

  it('escapa el & primero (sin doble escape de lo ya generado)', () => {
    expect(escaparHtml('&lt;')).toBe('&amp;lt;')
  })
})

describe('truncar', () => {
  it('deja igual un texto corto (con espacios normalizados)', () => {
    expect(truncar('  hola\n\nmundo\t ', 20)).toBe('hola mundo')
  })

  it('corta en el último espacio y agrega elipsis sin pasarse del máximo', () => {
    const texto = 'Manta de algodón tejida a mano con ribete festoneado y bordado'
    const salida = truncar(texto, 30)
    expect(Array.from(salida).length).toBeLessThanOrEqual(30)
    expect(salida.endsWith('…')).toBe(true)
    expect(texto.startsWith(salida.slice(0, -1))).toBe(true)
    expect(salida).not.toMatch(/\s…$/)
  })

  it('corta una palabra larguísima sin espacios', () => {
    const salida = truncar('a'.repeat(500), 20)
    expect(Array.from(salida).length).toBe(20)
  })

  it('no parte un emoji a la mitad', () => {
    const salida = truncar('🐑'.repeat(50), 10)
    expect(Array.from(salida)).toHaveLength(10)
    expect(salida).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
  })
})

describe('precioArs', () => {
  it('formatea en pesos sin decimales y con espacio común', () => {
    expect(plano(precioArs(12500)!)).toBe('$ 12.500')
    expect(precioArs(12500)).not.toContain(' ')
  })

  it('acepta el numeric de Postgres como texto', () => {
    expect(plano(precioArs('1500.00')!)).toBe('$ 1.500')
  })

  it('devuelve null para precios inválidos, cero o negativos', () => {
    for (const p of [null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY, 'abc', '']) {
      expect(precioArs(p as ProductoOg['precio'])).toBeNull()
    }
  })
})

describe('urlDelSitio', () => {
  it('saca la barra final', () => {
    expect(urlDelSitio('https://ejemplo.com/')).toBe('https://ejemplo.com')
  })

  it('cae al dominio de producción si falta o no es válida', () => {
    for (const v of [undefined, null, '', 'ejemplo.com', 'javascript:alert(1)', 'https://a.com/"><x']) {
      expect(urlDelSitio(v)).toBe(SITIO_POR_DEFECTO)
    }
  })
})

describe('imagenAbsoluta', () => {
  it('acepta https', () => {
    expect(imagenAbsoluta(FOTO, SITIO)).toBe(FOTO)
  })

  it('rechaza http, data: y basura', () => {
    expect(imagenAbsoluta('http://inseguro.com/a.jpg', SITIO)).toBeNull()
    expect(imagenAbsoluta('data:image/svg+xml,%3Csvg%3E', SITIO)).toBeNull()
    expect(imagenAbsoluta('javascript:alert(1)', SITIO)).toBeNull()
    expect(imagenAbsoluta('no es una url', SITIO)).toBeNull()
    expect(imagenAbsoluta('', SITIO)).toBeNull()
    expect(imagenAbsoluta(null, SITIO)).toBeNull()
  })

  it('completa una ruta relativa con el sitio, pero no una sin protocolo', () => {
    expect(imagenAbsoluta('/og-image.jpg', SITIO)).toBe(`${SITIO}/og-image.jpg`)
    expect(imagenAbsoluta('//otro.com/a.jpg', SITIO)).toBeNull()
  })

  it('codifica caracteres raros de la URL', () => {
    expect(imagenAbsoluta('https://a.com/foto "x".jpg', SITIO)).toBe('https://a.com/foto%20%22x%22.jpg')
  })
})

describe('imagenProducto', () => {
  it('usa la primera imagen utilizable de la galería', () => {
    expect(imagenProducto({ imagenes: ['http://x.com/a.jpg', '', FOTO], imagen_url: null }, SITIO)).toBe(FOTO)
  })

  it('cae a la portada si la galería no sirve', () => {
    expect(imagenProducto({ imagenes: null, imagen_url: FOTO }, SITIO)).toBe(FOTO)
  })

  it('null si no hay ninguna', () => {
    expect(imagenProducto({ imagenes: [], imagen_url: null }, SITIO)).toBeNull()
  })
})

describe('consultaDeParam', () => {
  it('reconoce un uuid (en minúsculas)', () => {
    expect(consultaDeParam('3F2A1B4C-1111-2222-3333-444455556666')).toEqual({
      columna: 'id',
      valor: '3f2a1b4c-1111-2222-3333-444455556666',
    })
  })

  it('reconoce un slug, también codificado', () => {
    expect(consultaDeParam('babero-rayado-2')).toEqual({ columna: 'slug', valor: 'babero-rayado-2' })
    expect(consultaDeParam('babero%2Drayado')).toEqual({ columna: 'slug', valor: 'babero-rayado' })
  })

  it('rechaza lo que no puede ser un producto (sin consultar la base)', () => {
    for (const p of [
      null,
      undefined,
      '',
      'Babero',
      'babero--rayado',
      '-babero',
      'babero,rayado',
      'eq.x&select=*',
      '%E0%A4%A',
      'a'.repeat(201),
      '<script>',
    ]) {
      expect(consultaDeParam(p)).toBeNull()
    }
  })
})

describe('descripcionProducto', () => {
  it('descripción + precio', () => {
    expect(plano(descripcionProducto({ descripcion: 'Babero de algodón.', precio: 12500 }))).toBe(
      'Babero de algodón. · $ 12.500',
    )
  })

  it('sin descripción: precio + frase de la marca', () => {
    expect(plano(descripcionProducto({ descripcion: '   ', precio: 900 }))).toBe(
      '$ 900 · Accesorios textiles para bebés hechos a mano.',
    )
  })

  it('sin descripción ni precio: la genérica', () => {
    expect(descripcionProducto({ descripcion: null, precio: null })).toBe(DESCRIPCION_GENERICA)
  })

  it('sin precio: solo la descripción', () => {
    expect(descripcionProducto({ descripcion: 'Hola', precio: 0 })).toBe('Hola')
  })

  it('recorta la descripción larga pero mantiene el precio entero', () => {
    const salida = plano(descripcionProducto({ descripcion: 'palabra '.repeat(100), precio: 1234567 }))
    expect(Array.from(salida).length).toBeLessThanOrEqual(MAX_DESCRIPCION)
    expect(salida.endsWith('… · $ 1.234.567')).toBe(true)
  })
})

describe('metaProducto', () => {
  it('arma título, descripción, imagen, URL canónica y tarjeta grande', () => {
    const meta = metaProducto(producto(), SITIO)
    expect(meta.titulo).toBe('Babero rayado · Pecora')
    expect(meta.canonica).toBe(`${SITIO}/producto/babero-rayado`)
    expect(valor(meta, 'og:title')).toBe('Babero rayado')
    expect(plano(valor(meta, 'og:description')!)).toBe('Babero de algodón con broche. · $ 12.500')
    expect(valor(meta, 'og:image')).toBe(FOTO)
    expect(valor(meta, 'og:url')).toBe(`${SITIO}/producto/babero-rayado`)
    expect(valor(meta, 'og:type')).toBe('product')
    expect(valor(meta, 'twitter:card')).toBe('summary_large_image')
    expect(valor(meta, 'twitter:image')).toBe(FOTO)
    expect(valor(meta, 'product:price:amount')).toBe('12500')
    expect(valor(meta, 'product:price:currency')).toBe('ARS')
    // Las medidas de la imagen genérica no se aplican a la foto del producto.
    expect(valor(meta, 'og:image:width')).toBeUndefined()
  })

  it('sin slug usa el id en la URL', () => {
    const meta = metaProducto(producto({ slug: null }), SITIO)
    expect(valor(meta, 'og:url')).toBe(`${SITIO}/producto/3f2a1b4c-1111-2222-3333-444455556666`)
  })

  it('sin foto https usa la imagen genérica con sus medidas', () => {
    const meta = metaProducto(producto({ imagenes: ['http://x.com/a.jpg'], imagen_url: null }), SITIO)
    expect(valor(meta, 'og:image')).toBe(`${SITIO}/og-image.jpg`)
    expect(valor(meta, 'og:image:width')).toBe('1200')
    expect(valor(meta, 'twitter:image')).toBe(`${SITIO}/og-image.jpg`)
  })

  it('sin precio no agrega product:price', () => {
    const meta = metaProducto(producto({ precio: null }), SITIO)
    expect(valor(meta, 'product:price:amount')).toBeUndefined()
  })

  it('recorta un nombre larguísimo', () => {
    const meta = metaProducto(producto({ nombre: 'Babero '.repeat(40) }), SITIO)
    expect(Array.from(valor(meta, 'og:title')!).length).toBeLessThanOrEqual(MAX_TITULO)
  })

  it('producto inexistente o sin nombre: la vista previa genérica', () => {
    expect(metaProducto(null, SITIO)).toEqual(metaGenerica(SITIO))
    expect(metaProducto(undefined, SITIO)).toEqual(metaGenerica(SITIO))
    expect(metaProducto(producto({ nombre: '  ' }), SITIO)).toEqual(metaGenerica(SITIO))
  })

  it('sitio inválido: usa el dominio de producción', () => {
    expect(metaProducto(producto(), 'no-es-url').canonica).toBe(`${SITIO_POR_DEFECTO}/producto/babero-rayado`)
  })
})

describe('metaGenerica', () => {
  it('coincide con la vista previa de index.html', () => {
    const meta = metaGenerica(SITIO)
    expect(meta.titulo).toBe(TITULO_GENERICO)
    expect(valor(meta, 'og:url')).toBe(`${SITIO}/`)
    expect(valor(meta, 'og:image')).toBe(`${SITIO}/og-image.jpg`)
    expect(valor(meta, 'twitter:card')).toBe('summary_large_image')
  })
})

describe('htmlDeMeta', () => {
  it('escapa todo lo que viene del producto (intento de inyección)', () => {
    const malicioso = `</title><script>alert("x")</script><meta property="og:image" content="https://evil.com/x.jpg`
    const html = htmlDeMeta(
      metaProducto(producto({ nombre: malicioso, descripcion: `"><img src=x onerror=alert(1)>` }), SITIO),
    )
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('"><')
    // Una sola og:image real: la del producto.
    expect(html.match(/<meta property="og:image" /g)).toHaveLength(1)
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;')
    // Solo un <title> y se cierra una vez.
    expect(html.match(/<\/title>/g)).toHaveLength(1)
  })
})

describe('inyectarMeta', () => {
  it('reemplaza título y meta de vista previa y conserva el resto del documento', () => {
    const salida = inyectarMeta(INDEX, metaProducto(producto(), SITIO))
    expect(salida.match(/<title>/g)).toHaveLength(1)
    expect(salida).toContain('<title>Babero rayado · Pecora</title>')
    expect(salida.match(/property="og:title"/g)).toHaveLength(1)
    expect(salida.match(/name="description"/g)).toHaveLength(1)
    expect(salida.match(/name="twitter:card"/g)).toHaveLength(1)
    expect(salida).not.toContain('content="Genérica"')
    expect(salida).not.toContain('og:image:width')
    expect(salida).toContain(`<link rel="canonical" href="${SITIO}/producto/babero-rayado" />`)
    // Lo demás queda: charset, viewport, theme-color, assets de Vite, body.
    expect(salida).toContain('<meta charset="UTF-8" />')
    expect(salida).toContain('name="theme-color"')
    expect(salida).toContain('src="/assets/index-abc123.js"')
    expect(salida).toContain('href="/assets/index-abc123.css"')
    expect(salida).toContain('<div id="root"></div>')
    // Las meta nuevas quedan dentro del <head>.
    expect(salida.indexOf('og:title')).toBeLessThan(salida.indexOf('</head>'))
  })

  it('reemplaza también una canónica previa y no toca robots', () => {
    const conExtras = INDEX.replace(
      '</head>',
      '<link rel="canonical" href="https://viejo.com/" />\n<meta name="robots" content="noindex" />\n</head>',
    )
    const salida = inyectarMeta(conExtras, metaGenerica(SITIO))
    expect(salida).not.toContain('viejo.com')
    expect(salida).toContain('<meta name="robots" content="noindex" />')
  })

  it('es idempotente (inyectar dos veces no duplica)', () => {
    const meta = metaProducto(producto(), SITIO)
    const una = inyectarMeta(INDEX, meta)
    expect(inyectarMeta(una, meta)).toBe(una)
  })

  it('sin </head> devuelve el HTML tal cual', () => {
    expect(inyectarMeta('<html>sin head</html>', metaGenerica(SITIO))).toBe('<html>sin head</html>')
  })
})

describe('htmlDeRespaldo', () => {
  it('es un documento completo con las meta y un link escapado', () => {
    const html = htmlDeRespaldo(metaProducto(producto({ nombre: 'A & B' }), SITIO))
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('<meta property="og:title" content="A &amp; B" />')
    expect(html).toContain(`<a href="${SITIO}/producto/babero-rayado">A &amp; B · Pecora</a>`)
  })
})
