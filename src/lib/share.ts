import type { Producto } from '../types'
import { catalogoUrl } from './config'
import { money } from './format'

// ============================================================================
// Compartir un producto: link público, hoja nativa de compartir (celulares y
// algunos navegadores de escritorio) con WhatsApp como alternativa, y copiar
// el link al portapapeles.
// ============================================================================

type ProductoCompartible = Pick<Producto, 'id' | 'slug' | 'nombre' | 'precio'>

// Link público de la ficha. Usa el slug si existe y, si no, el id: la página
// /producto/:param resuelve ambos (ver ProductPage).
export function urlProducto(p: Pick<Producto, 'id' | 'slug'>): string {
  return `${catalogoUrl()}/producto/${encodeURIComponent(p.slug ?? p.id)}`
}

// Texto que acompaña al link. money() separa "$" del número con un espacio
// duro (U+00A0); se cambia por uno común para que se vea bien en cualquier app.
function textoProducto(p: ProductoCompartible): string {
  return `${p.nombre} · ${money(p.precio).replace(/ /g, ' ')} en Pecora`
}

// ¿El navegador tiene la hoja nativa de compartir (Web Share API)?
export function puedeCompartirNativo(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

// Link de WhatsApp sin destinatario: la clienta elige a quién mandarlo.
function waCompartirLink(p: ProductoCompartible): string {
  return `https://wa.me/?text=${encodeURIComponent(`${textoProducto(p)} ${urlProducto(p)}`)}`
}

// Abre la hoja nativa de compartir; si no existe, abre WhatsApp en otra pestaña.
// Cerrar la hoja sin elegir nada (AbortError) no es un error: no se hace nada.
export async function compartirProducto(p: ProductoCompartible): Promise<void> {
  if (puedeCompartirNativo()) {
    try {
      await navigator.share({ title: p.nombre, text: textoProducto(p), url: urlProducto(p) })
      return
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      // Otro fallo (ej. el navegador rechazó los datos): se sigue con WhatsApp.
      console.warn('No se pudo usar la hoja de compartir; se abre WhatsApp.', e)
    }
  }
  // Sin await previo cuando no hay hoja nativa: la apertura ocurre dentro del
  // mismo click, así el bloqueador de ventanas emergentes no la frena.
  window.open(waCompartirLink(p), '_blank', 'noopener,noreferrer')
}

// Copia el link de la ficha. Devuelve true si se pudo copiar.
// La API del portapapeles solo existe en contextos seguros (https/localhost);
// si falta o falla, se usa el método clásico con un textarea temporal.
export async function copiarLink(p: Pick<Producto, 'id' | 'slug'>): Promise<boolean> {
  const url = urlProducto(p)
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url)
      return true
    }
  } catch {
    // Permiso denegado o sin foco: se prueba el plan B.
  }
  return copiarConTextarea(url)
}

function copiarConTextarea(texto: string): boolean {
  const foco = document.activeElement as HTMLElement | null
  const area = document.createElement('textarea')
  area.value = texto
  area.setAttribute('readonly', '')
  // Fuera de la vista y con 16px: con menos, iOS hace zoom al seleccionar.
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.opacity = '0'
  area.style.fontSize = '16px'
  document.body.appendChild(area)
  area.select()
  area.setSelectionRange(0, texto.length) // iOS no respeta select() solo
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(area)
  foco?.focus()
  return ok
}
