import { describe, expect, it } from 'vitest'
import { celda, crearHandlerFeed, csvFeed, filasDeProducto, precioMeta, type FilaProductoFeed } from '../catalogo-meta.js'

const SITIO = 'https://pecora.test'
const IMG = 'https://abc.supabase.co/storage/v1/object/public/productos/a.jpg'
const IMG2 = 'https://abc.supabase.co/storage/v1/object/public/productos/b.jpg'
const ENV = {
  VITE_APP_MODE: 'catalog',
  VITE_SUPABASE_URL: 'https://abc.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'clave',
  VITE_CATALOG_URL: SITIO,
}

const producto = (extra: Partial<FilaProductoFeed> = {}): FilaProductoFeed => ({
  id: 'p1',
  slug: 'body-rayado',
  nombre: 'Body "rayado", algodón',
  descripcion: 'Suave.\nPara todos los días.',
  precio: 12500,
  stock: 3,
  imagen_url: null,
  imagenes: [IMG, IMG2],
  categorias: { nombre: 'Bodies' },
  ...extra,
})

describe('feed de Meta', () => {
  it('celda escapa comas, comillas y saltos de línea', () => {
    expect(celda('simple')).toBe('simple')
    expect(celda('a, b')).toBe('"a, b"')
    expect(celda('dice "hola"')).toBe('"dice ""hola"""')
    expect(celda('dos\nlíneas')).toBe('dos líneas')
  })

  it('precio en pesos con dos decimales', () => {
    expect(precioMeta(12500)).toBe('12500.00 ARS')
    expect(precioMeta('999.5')).toBe('999.50 ARS')
    expect(precioMeta(0)).toBeNull()
  })

  it('un producto sin talles es una fila', () => {
    const [f, ...resto] = filasDeProducto(producto(), SITIO)
    expect(resto).toHaveLength(0)
    expect(f).toMatchObject({
      id: 'p1',
      item_group_id: '',
      availability: 'in stock',
      condition: 'new',
      price: '12500.00 ARS',
      link: `${SITIO}/producto/body-rayado`,
      image_link: IMG,
      additional_image_link: IMG2,
      brand: 'Pecora',
      product_type: 'Bodies',
      inventory: '3',
    })
    expect(f.description).toBe('Suave. Para todos los días.')
  })

  it('agotado y sin datos mínimos', () => {
    expect(filasDeProducto(producto({ stock: 0 }), SITIO)[0].availability).toBe('out of stock')
    expect(filasDeProducto(producto({ precio: 0 }), SITIO)).toEqual([])
    expect(filasDeProducto(producto({ imagenes: [], imagen_url: null }), SITIO)).toEqual([])
    expect(filasDeProducto(producto({ nombre: ' ' }), SITIO)).toEqual([])
  })

  it('con talles: una fila por talle, agrupadas', () => {
    const filas = filasDeProducto(
      producto({
        producto_talles: [
          { id: 't2', talle: '3-6 m', stock: 0, orden: 1 },
          { id: 't1', talle: '0-3 m', stock: 2, orden: 0 },
        ],
      }),
      SITIO,
    )
    expect(filas.map((f) => [f.id, f.item_group_id, f.size, f.availability])).toEqual([
      ['p1-t1', 'p1', '0-3 m', 'in stock'],
      ['p1-t2', 'p1', '3-6 m', 'out of stock'],
    ])
  })

  it('el CSV tiene encabezado y escapa el título', () => {
    const csv = csvFeed(filasDeProducto(producto(), SITIO))
    const [encabezado, fila] = csv.trim().split('\n')
    expect(encabezado.startsWith('id,item_group_id,title,')).toBe(true)
    expect(fila).toContain('"Body ""rayado"", algodón"')
  })

  it('GET arma el feed; si Supabase falla contesta 503 (no un feed vacío)', async () => {
    const ok = crearHandlerFeed({
      fetch: async () => new Response(JSON.stringify([producto()])),
      env: () => ENV,
      log: () => {},
    })
    const r = await ok.GET()
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/csv')
    expect(await r.text()).toContain('p1,')

    const mal = crearHandlerFeed({
      fetch: async () => {
        throw new Error('red')
      },
      env: () => ENV,
      log: () => {},
    })
    expect((await mal.GET()).status).toBe(503)
  })

  it('sin la migración de talles reintenta sin la relación', async () => {
    const urls: string[] = []
    const h = crearHandlerFeed({
      fetch: async (url) => {
        urls.push(url)
        return urls.length === 1 ? new Response('{}', { status: 400 }) : new Response(JSON.stringify([producto()]))
      },
      env: () => ENV,
      log: () => {},
    })
    expect((await h.GET()).status).toBe(200)
    expect(urls[0]).toContain('producto_talles')
    expect(urls[1]).not.toContain('producto_talles')
  })

  it('en el panel contesta 404', async () => {
    const h = crearHandlerFeed({ fetch: async () => new Response('[]'), env: () => ({ ...ENV, VITE_APP_MODE: 'admin' }), log: () => {} })
    expect((await h.GET()).status).toBe(404)
  })
})
