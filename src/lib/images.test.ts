import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// images.ts arma el prefijo del bucket con VITE_SUPABASE_URL al cargarse: se
// fija un proyecto de prueba (con barra final, que se tiene que ignorar) y se
// importa el módulo recién después.
const BASE = 'https://proyecto.supabase.co'
const PUB = `${BASE}/storage/v1/object/public/productos/`

let img: typeof import('./images')

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', `${BASE}/`)
  vi.resetModules()
  img = await import('./images')
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('rutaEnBucket', () => {
  it('devuelve la ruta dentro del bucket de una URL pública nuestra', () => {
    expect(img.rutaEnBucket(`${PUB}3f2a-uuid.jpg`)).toBe('3f2a-uuid.jpg')
    expect(img.rutaEnBucket(`${PUB}carpeta/foto.png`)).toBe('carpeta/foto.png')
  })

  it('ignora query y hash', () => {
    expect(img.rutaEnBucket(`${PUB}3f2a.jpg?v=2`)).toBe('3f2a.jpg')
    expect(img.rutaEnBucket(`${PUB}3f2a.jpg#zoom`)).toBe('3f2a.jpg')
    expect(img.rutaEnBucket(`${PUB}3f2a.jpg?v=2#zoom`)).toBe('3f2a.jpg')
  })

  it('decodifica los nombres codificados', () => {
    expect(img.rutaEnBucket(`${PUB}foto%20vieja.png`)).toBe('foto vieja.png')
    expect(img.rutaEnBucket(`${PUB}ni%C3%B1o.jpg`)).toBe('niño.jpg')
  })

  it('null si la codificación está rota', () => {
    expect(img.rutaEnBucket(`${PUB}mal%E0%A4.jpg`)).toBeNull()
  })

  it('null para otro proyecto, otro bucket, URLs firmadas o el bucket sin ruta', () => {
    expect(img.rutaEnBucket('https://otro.supabase.co/storage/v1/object/public/productos/x.jpg')).toBeNull()
    expect(img.rutaEnBucket(`${BASE}/storage/v1/object/public/otro/x.jpg`)).toBeNull()
    expect(img.rutaEnBucket(`${BASE}/storage/v1/object/public/productos-viejos/x.jpg`)).toBeNull()
    expect(img.rutaEnBucket(`${BASE}/storage/v1/object/sign/productos/x.jpg?token=abc`)).toBeNull()
    expect(img.rutaEnBucket(PUB)).toBeNull()
    expect(img.rutaEnBucket(`${PUB}?v=1`)).toBeNull()
  })

  it('null para el placeholder y URLs ajenas', () => {
    expect(img.rutaEnBucket(img.IMG_PLACEHOLDER)).toBeNull()
    expect(img.rutaEnBucket('https://instagram.com/foto.jpg')).toBeNull()
    expect(img.rutaEnBucket('')).toBeNull()
  })
})

describe('rutaMiniatura', () => {
  it('va a thumbs/ con la misma ruta y extensión .jpg', () => {
    expect(img.rutaMiniatura('3f2a.jpg')).toBe('thumbs/3f2a.jpg')
    expect(img.rutaMiniatura('vieja.png')).toBe('thumbs/vieja.jpg')
    expect(img.rutaMiniatura('a/b.webp')).toBe('thumbs/a/b.jpg')
    expect(img.rutaMiniatura('foto vieja.PNG')).toBe('thumbs/foto vieja.jpg')
  })

  it('solo cambia la extensión del último tramo', () => {
    expect(img.rutaMiniatura('sin-extension')).toBe('thumbs/sin-extension.jpg')
    expect(img.rutaMiniatura('carpeta.v2/foto')).toBe('thumbs/carpeta.v2/foto.jpg')
    expect(img.rutaMiniatura('x.tar.gz')).toBe('thumbs/x.tar.jpg')
  })
})

describe('esRutaMiniatura', () => {
  it('solo las rutas dentro de thumbs/', () => {
    expect(img.esRutaMiniatura('thumbs/a.jpg')).toBe(true)
    expect(img.esRutaMiniatura('thumbs/sub/a.jpg')).toBe(true)
    expect(img.esRutaMiniatura('a.jpg')).toBe(false)
    expect(img.esRutaMiniatura('thumbsx/a.jpg')).toBe(false)
    expect(img.esRutaMiniatura('fotos/thumbs/a.jpg')).toBe(false)
    expect(img.esRutaMiniatura('thumbs')).toBe(false)
  })
})

describe('miniaturaDe', () => {
  it('URL pública de la miniatura de un original nuestro', () => {
    expect(img.miniaturaDe(`${PUB}3f2a.jpg`)).toBe(`${PUB}thumbs/3f2a.jpg`)
    expect(img.miniaturaDe(`${PUB}vieja.png`)).toBe(`${PUB}thumbs/vieja.jpg`)
  })

  it('conserva la codificación y descarta query y hash', () => {
    expect(img.miniaturaDe(`${PUB}foto%20vieja.png?v=1#a`)).toBe(`${PUB}thumbs/foto%20vieja.jpg`)
    expect(img.miniaturaDe(`${PUB}ni%C3%B1o.webp`)).toBe(`${PUB}thumbs/ni%C3%B1o.jpg`)
  })

  it('una miniatura, el placeholder o una URL ajena vuelven tal cual', () => {
    const yaMiniatura = `${PUB}thumbs/3f2a.jpg`
    expect(img.miniaturaDe(yaMiniatura)).toBe(yaMiniatura)
    expect(img.miniaturaDe(img.IMG_PLACEHOLDER)).toBe(img.IMG_PLACEHOLDER)
    expect(img.miniaturaDe('https://otro.com/a.jpg')).toBe('https://otro.com/a.jpg')
  })
})

describe('rutaMiniaturaDe', () => {
  it('ruta sin codificar de la miniatura (la que figura en el listado de Storage)', () => {
    expect(img.rutaMiniaturaDe(`${PUB}3f2a.jpg`)).toBe('thumbs/3f2a.jpg')
    expect(img.rutaMiniaturaDe(`${PUB}foto%20vieja.png?v=3`)).toBe('thumbs/foto vieja.jpg')
  })

  it('null para miniaturas, el placeholder y URLs ajenas', () => {
    expect(img.rutaMiniaturaDe(`${PUB}thumbs/3f2a.jpg`)).toBeNull()
    expect(img.rutaMiniaturaDe(img.IMG_PLACEHOLDER)).toBeNull()
    expect(img.rutaMiniaturaDe('https://otro.com/a.jpg')).toBeNull()
  })

  it('coincide con la ruta de la URL que arma miniaturaDe', () => {
    for (const url of [`${PUB}3f2a.jpg`, `${PUB}foto%20vieja.png`, `${PUB}a/ni%C3%B1o.webp?x=1`]) {
      expect(img.rutaEnBucket(img.miniaturaDe(url))).toBe(img.rutaMiniaturaDe(url))
    }
  })
})

describe('sin VITE_SUPABASE_URL', () => {
  it('ninguna URL se reconoce como del bucket (todo queda como original)', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.resetModules()
    const sinUrl = await import('./images')
    const relativa = '/storage/v1/object/public/productos/3f2a.jpg'
    expect(sinUrl.rutaEnBucket(relativa)).toBeNull()
    expect(sinUrl.rutaEnBucket(`${PUB}3f2a.jpg`)).toBeNull()
    expect(sinUrl.miniaturaDe(relativa)).toBe(relativa)
    expect(sinUrl.rutaMiniaturaDe(`${PUB}3f2a.jpg`)).toBeNull()
  })
})
