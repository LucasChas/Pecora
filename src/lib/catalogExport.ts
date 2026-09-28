import type { Categoria, ProductoConCategoria } from '../types'

// ============================================================================
// Lógica pura de la LISTA DE PRECIOS exportable (botón "Exportar catálogo").
// Sin React ni DOM: agrupa los productos, arma las bandas de la grilla y
// reparte las bandas en hojas A4 a partir de alturas ya medidas (las fotos se
// preparan de a pocas y con tope de tiempo, ver lib/tareas). Así se puede
// probar aislada y la vista (components/admin/CatalogExport) solo mide y dibuja.
// ============================================================================

// Columnas de cada banda (igual que la plantilla impresa).
export const COLUMNAS = 5

// Una categoría con sus productos, en el orden en que se imprime.
export interface GrupoLista {
  clave: string // id de la categoría, o 'otros'
  titulo: string
  productos: ProductoConCategoria[]
}

// Una categoría dentro de una banda, con las columnas que ocupa.
export interface BloqueBanda {
  grupo: GrupoLista
  columnas: number
}

// Fila de la grilla de 5 columnas: una categoría grande o varias chicas juntas.
export type Banda = BloqueBanda[]

// Agrupa por categoría respetando el orden de categorías del muestrario
// (el de useCategories: alfabético). Dentro de cada grupo se mantiene el orden
// en que llegan los productos (el mismo de la grilla pública). Los productos
// sin categoría (o con una que ya no existe) van al final, en "Otros".
export function agruparPorCategoria(
  productos: ProductoConCategoria[],
  categorias: Categoria[],
): GrupoLista[] {
  const porCategoria = new Map<string, ProductoConCategoria[]>()
  const otros: ProductoConCategoria[] = []
  const existentes = new Set(categorias.map((c) => c.id))

  for (const p of productos) {
    if (p.categoria_id && existentes.has(p.categoria_id)) {
      const lista = porCategoria.get(p.categoria_id) ?? []
      lista.push(p)
      porCategoria.set(p.categoria_id, lista)
    } else {
      otros.push(p)
    }
  }

  const grupos = categorias.flatMap((c) => {
    const lista = porCategoria.get(c.id)
    return lista ? [{ clave: c.id, titulo: c.nombre, productos: lista }] : []
  })
  if (otros.length > 0) grupos.push({ clave: 'otros', titulo: 'Otros', productos: otros })
  return grupos
}

// Columnas que ocupa una categoría: todo el ancho si tiene más de 5 productos
// (y baja en varias filas); si no, tantas como productos, con un mínimo de 2
// para que el título no quede apretado.
export function columnasDe(grupo: GrupoLista): number {
  const cantidad = grupo.productos.length
  return cantidad > COLUMNAS ? COLUMNAS : Math.max(cantidad, 2)
}

// Arma las bandas en forma "greedy" sin alterar el orden: categorías chicas
// consecutivas comparten banda mientras entren en las 5 columnas
// (ej. Mantas(3) + Toallas(2)); una categoría grande ocupa su banda sola.
export function armarBandas(grupos: GrupoLista[]): Banda[] {
  const bandas: Banda[] = []
  let actual: Banda = []
  let usadas = 0

  for (const grupo of grupos) {
    const columnas = columnasDe(grupo)
    if (actual.length > 0 && usadas + columnas > COLUMNAS) {
      bandas.push(actual)
      actual = []
      usadas = 0
    }
    actual.push({ grupo, columnas })
    usadas += columnas
  }
  if (actual.length > 0) bandas.push(actual)
  return bandas
}

// ---- Paginación ------------------------------------------------------------

// Alturas medidas de una banda (en px CSS). "filas" solo viene en bandas de
// UNA categoría con más de una fila de cards: son las que se pueden cortar.
export interface MedidaBanda {
  alto: number
  filas?: {
    cabecera: number // título + su margen, hasta el borde superior de las cards
    tramos: { arriba: number; abajo: number }[] // cada fila, relativa a la grilla
  }
}

// Espacio útil del cuerpo de una hoja y la separación entre bandas.
export interface MedidaHoja {
  capacidad: number
  separacion: number
}

// Lo que se dibuja en una hoja: una banda entera o un tramo de filas
// [desde, hasta) de una categoría larga (continuacion = no es el primer tramo).
export interface Fragmento {
  banda: number
  filas: [number, number] | null
  continuacion: boolean
}

// Reparte las bandas en hojas. La primera hoja tiene otra capacidad (header
// grande). Se corta entre bandas; si una categoría larga no entra en lo que
// queda de la hoja, se parte entre filas de cards y sigue en la próxima hoja.
export function paginar(
  medidas: MedidaBanda[],
  primera: MedidaHoja,
  resto: MedidaHoja,
): Fragmento[][] {
  const hojas: Fragmento[][] = [[]]
  let ocupado = 0

  const actual = () => hojas[hojas.length - 1]
  const hoja = () => (hojas.length === 1 ? primera : resto)
  // Lo que suma un bloque en la hoja actual (con la separación si no es el primero).
  const costo = (alto: number) => (actual().length === 0 ? alto : hoja().separacion + alto)
  const entra = (alto: number) => ocupado + costo(alto) <= hoja().capacidad
  const colocar = (fragmento: Fragmento, alto: number) => {
    ocupado += costo(alto)
    actual().push(fragmento)
  }
  const nuevaHoja = () => {
    hojas.push([])
    ocupado = 0
  }

  medidas.forEach((medida, banda) => {
    if (entra(medida.alto)) {
      colocar({ banda, filas: null, continuacion: false }, medida.alto)
      return
    }

    // Banda de una sola fila: pasa entera a la hoja siguiente.
    if (!medida.filas) {
      if (actual().length > 0) nuevaHoja()
      colocar({ banda, filas: null, continuacion: false }, medida.alto)
      return
    }

    // Categoría larga: se llena la hoja con todas las filas que entren.
    const { cabecera, tramos } = medida.filas
    const altoTramo = (desde: number, hasta: number) =>
      cabecera + tramos[hasta - 1].abajo - tramos[desde].arriba

    let desde = 0
    while (desde < tramos.length) {
      let hasta = desde
      while (hasta < tramos.length && entra(altoTramo(desde, hasta + 1))) hasta++

      if (hasta === desde) {
        // No entra ni una fila: si la hoja tiene algo, se sigue en otra.
        if (actual().length > 0) {
          nuevaHoja()
          continue
        }
        // Hoja vacía y aun así no entra (no debería pasar): se fuerza una fila.
        hasta = desde + 1
      }

      colocar({ banda, filas: [desde, hasta], continuacion: desde > 0 }, altoTramo(desde, hasta))
      desde = hasta
      if (desde < tramos.length) nuevaHoja()
    }
  })

  return hojas
}

// Productos de un bloque, recortados al tramo de filas si la categoría se partió.
export function productosDelTramo(
  grupo: GrupoLista,
  filas: [number, number] | null,
): ProductoConCategoria[] {
  if (!filas) return grupo.productos
  return grupo.productos.slice(filas[0] * COLUMNAS, filas[1] * COLUMNAS)
}

// "Septiembre 2026": mes en castellano con mayúscula inicial + año.
export function mesAnio(fecha: Date): string {
  const mes = fecha.toLocaleDateString('es-AR', { month: 'long' })
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${fecha.getFullYear()}`
}

// "Sep 2026": versión corta para la barra de la vista en el celular. Las tres
// primeras letras alcanzan para distinguir los meses en castellano.
export function mesAnioCorto(fecha: Date): string {
  return `${mesAnio(fecha).slice(0, 3)} ${fecha.getFullYear()}`
}

// ---- Fotos -----------------------------------------------------------------

// Lado (px) de las miniaturas de las cards: la card mide ~36 mm de ancho y a
// ~300 dpi eso son ~420 px. Más grande no se nota en papel y gasta memoria.
export const LADO_MINIATURA = 420

// Prefijo de los avisos en consola de esta vista.
export const PREFIJO_LOG = '[Exportar catálogo]'

// ---- Tareas asíncronas con tope de tiempo y concurrencia ---------------------
// Se mudaron a lib/tareas (son genéricas: también las usan las miniaturas
// automáticas del panel). Se re-exportan para no romper los imports existentes.
export { conTiempoMax, correrTareas, type Resultado } from './tareas'
