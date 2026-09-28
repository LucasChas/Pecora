import { afterEach, describe, expect, it, vi } from 'vitest'
import { catalogoUrl } from './config'
import { compartirProducto, copiarLink, puedeCompartirNativo, urlProducto } from './share'

// Los tests corren en Node: navigator, window y document se reemplazan con
// dobles mínimos (vi.stubGlobal) y se restauran después de cada test.

const producto = { id: 'p-1', slug: 'body-rayado', nombre: 'Body rayado', precio: 1500 }
const linkProducto = () => `${catalogoUrl()}/producto/body-rayado`
// Intl separa "$" del número con un espacio duro; share.ts lo cambia por uno
// común. Se normaliza igual para no depender de la versión de ICU.
const plano = (s: string) => s.replace(/\s/g, ' ')
const WA = 'https://wa.me/?text='

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

function stubWindow() {
  const open = vi.fn()
  vi.stubGlobal('window', { open })
  return open
}

// Textarea y document falsos para el método clásico de copiado.
function stubDocumento(execCommand: () => boolean) {
  const area = {
    value: '',
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
  }
  const foco = { focus: vi.fn() }
  const documento = {
    activeElement: foco,
    createElement: vi.fn(() => area),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
    execCommand: vi.fn(execCommand),
  }
  vi.stubGlobal('document', documento)
  return { area, foco, documento }
}

describe('urlProducto', () => {
  it('usa el slug cuando existe', () => {
    expect(urlProducto({ id: 'p-1', slug: 'body-rayado' })).toBe(linkProducto())
  })

  it('sin slug usa el id', () => {
    expect(urlProducto({ id: '3f2a-uuid', slug: null })).toBe(`${catalogoUrl()}/producto/3f2a-uuid`)
  })

  it('codifica el parámetro de la ruta', () => {
    expect(urlProducto({ id: 'x', slug: 'niño & co/2' })).toBe(
      `${catalogoUrl()}/producto/ni%C3%B1o%20%26%20co%2F2`,
    )
  })

  it('la base es la URL pública del muestrario (VITE_CATALOG_URL normalizada)', async () => {
    vi.stubEnv('VITE_CATALOG_URL', 'tienda.ejemplo.com/')
    vi.resetModules()
    const share = await import('./share')
    expect(share.urlProducto({ id: 'x', slug: 'body' })).toBe(
      'https://tienda.ejemplo.com/producto/body',
    )
  })
})

describe('puedeCompartirNativo', () => {
  it('es true solo si navigator.share es una función', () => {
    vi.stubGlobal('navigator', { share: vi.fn() })
    expect(puedeCompartirNativo()).toBe(true)
    vi.stubGlobal('navigator', {})
    expect(puedeCompartirNativo()).toBe(false)
    vi.stubGlobal('navigator', undefined)
    expect(puedeCompartirNativo()).toBe(false)
  })
})

describe('compartirProducto', () => {
  it('con hoja nativa comparte título, texto y link, sin abrir WhatsApp', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share })
    const open = stubWindow()

    await compartirProducto(producto)

    expect(share).toHaveBeenCalledTimes(1)
    const datos = share.mock.calls[0][0] as { title: string; text: string; url: string }
    expect(datos.title).toBe('Body rayado')
    expect(datos.url).toBe(linkProducto())
    expect(datos.text).not.toContain(' ')
    expect(plano(datos.text)).toBe('Body rayado · $ 1.500 en Pecora')
    expect(open).not.toHaveBeenCalled()
  })

  it('si la clienta cierra la hoja (AbortError) no hace nada más', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancelado', 'AbortError'))
    vi.stubGlobal('navigator', { share })
    const open = stubWindow()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(compartirProducto(producto)).resolves.toBeUndefined()

    expect(open).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([
    ['un TypeError', new TypeError('datos inválidos')],
    ['otro DOMException', new DOMException('sin gesto', 'NotAllowedError')],
  ])('si la hoja falla con %s, abre WhatsApp como alternativa', async (_caso, fallo) => {
    const share = vi.fn().mockRejectedValue(fallo)
    vi.stubGlobal('navigator', { share })
    const open = stubWindow()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await compartirProducto(producto)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledTimes(1)
    expect(String(open.mock.calls[0][0]).startsWith(WA)).toBe(true)
  })

  it('sin hoja nativa abre WhatsApp en el mismo click (antes de cualquier await)', async () => {
    vi.stubGlobal('navigator', {})
    const open = stubWindow()

    const promesa = compartirProducto(producto)
    // Sincrónico: si hubiera un await previo, el bloqueador de popups lo frenaría.
    expect(open).toHaveBeenCalledTimes(1)
    await promesa

    const [url, destino, opciones] = open.mock.calls[0] as [string, string, string]
    expect(url.startsWith(WA)).toBe(true)
    expect(plano(decodeURIComponent(url.slice(WA.length)))).toBe(
      `Body rayado · $ 1.500 en Pecora ${linkProducto()}`,
    )
    expect(destino).toBe('_blank')
    expect(opciones).toBe('noopener,noreferrer')
  })

  it('sin navigator (entorno sin API) también cae en WhatsApp', async () => {
    vi.stubGlobal('navigator', undefined)
    const open = stubWindow()
    await compartirProducto(producto)
    expect(open).toHaveBeenCalledTimes(1)
  })
})

describe('copiarLink', () => {
  it('con la API del portapapeles copia el link y devuelve true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { documento } = stubDocumento(() => true)

    await expect(copiarLink(producto)).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith(linkProducto())
    expect(documento.createElement).not.toHaveBeenCalled()
  })

  it('si el portapapeles rechaza, copia con un textarea temporal', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('denegado', 'NotAllowedError'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { area, foco, documento } = stubDocumento(() => true)

    await expect(copiarLink(producto)).resolves.toBe(true)

    const url = linkProducto()
    expect(documento.createElement).toHaveBeenCalledWith('textarea')
    expect(area.value).toBe(url)
    expect(area.style.fontSize).toBe('16px')
    expect(area.setSelectionRange).toHaveBeenCalledWith(0, url.length)
    expect(documento.execCommand).toHaveBeenCalledWith('copy')
    expect(documento.body.appendChild).toHaveBeenCalledWith(area)
    expect(documento.body.removeChild).toHaveBeenCalledWith(area)
    expect(foco.focus).toHaveBeenCalled()
  })

  it('sin API del portapapeles (contexto no seguro) usa el textarea', async () => {
    vi.stubGlobal('navigator', {})
    const { documento } = stubDocumento(() => true)
    await expect(copiarLink(producto)).resolves.toBe(true)
    expect(documento.execCommand).toHaveBeenCalledWith('copy')
  })

  it('devuelve false si el método clásico no pudo copiar', async () => {
    vi.stubGlobal('navigator', {})
    stubDocumento(() => false)
    await expect(copiarLink(producto)).resolves.toBe(false)
  })

  it('devuelve false y limpia el textarea si execCommand lanza', async () => {
    vi.stubGlobal('navigator', {})
    const { area, documento } = stubDocumento(() => {
      throw new Error('no soportado')
    })
    await expect(copiarLink(producto)).resolves.toBe(false)
    expect(documento.body.removeChild).toHaveBeenCalledWith(area)
  })
})
