import { supabase } from './supabaseClient'
import { parsearNumero } from './importacion'

// Ajuste de precios en bloque: un porcentaje (RPC ajustar_precios, migración
// 20261001040000) o un precio fijo (RPC fijar_precios, migración 20261011010000).

export interface CambioPrecio {
  id: string
  nombre: string
  antes: number
  despues: number
}

export interface OpcionesAjuste {
  porcentaje: number
  categoriaId: string | null
  // 0 = sin redondear; si no, al múltiplo más cercano (ej. 100).
  redondeo: number
}

export const REDONDEOS = [
  { valor: 0, texto: 'Sin redondear' },
  { valor: 10, texto: 'A $10' },
  { valor: 100, texto: 'A $100' },
  { valor: 500, texto: 'A $500' },
  { valor: 1000, texto: 'A $1.000' },
]

// Valida lo que escribió antes de pedir la vista previa. null = está bien.
export function errorPorcentaje(texto: string): string | null {
  const n = Number(texto.replace(',', '.'))
  if (texto.trim() === '' || Number.isNaN(n)) return 'Escribí un porcentaje, por ejemplo 10.'
  if (n === 0) return 'Con 0 % no cambia nada.'
  if (n < -90 || n > 500) return 'Tiene que estar entre -90 % y 500 %.'
  return null
}

export function porcentajeDe(texto: string): number {
  return Number(texto.replace(',', '.'))
}

// Mismo tope que productos.precio (numeric(10,2)).
const PRECIO_MAXIMO = 99999999.99

// Precio fijo escrito a la argentina ("5.000", "$ 1.500,50"). null = no es número.
export function precioDe(texto: string): number | null {
  return parsearNumero(texto)
}

export function errorPrecio(texto: string): string | null {
  const n = precioDe(texto)
  if (n === null) return 'Escribí un precio, por ejemplo 5000.'
  if (n <= 0) return 'El precio tiene que ser mayor a $0.'
  if (n > PRECIO_MAXIMO) return 'Ese precio es demasiado alto.'
  return null
}

type Resultado = { cambios: CambioPrecio[] } | { error: string }

// Pide la vista previa (simular = true) o aplica el ajuste (false).
export function ajustarPrecios(opciones: OpcionesAjuste, simular: boolean): Promise<Resultado> {
  return llamar('ajustar_precios', {
    p_porcentaje: opciones.porcentaje,
    p_categoria_id: opciones.categoriaId,
    p_redondeo: opciones.redondeo,
    p_simular: simular,
  })
}

// Deja todos los precios (o los de una categoría) en un mismo monto.
export function fijarPrecios(
  opciones: { precio: number; categoriaId: string | null },
  simular: boolean,
): Promise<Resultado> {
  return llamar('fijar_precios', {
    p_precio: opciones.precio,
    p_categoria_id: opciones.categoriaId,
    p_simular: simular,
  })
}

async function llamar(rpc: string, args: Record<string, unknown>): Promise<Resultado> {
  const { data, error } = await supabase.rpc(rpc, args)
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      return { error: `Falta aplicar la migración ${rpc} en Supabase.` }
    }
    if (error.code === '42501') return { error: 'Tu cuenta no puede cambiar precios.' }
    return { error: error.message }
  }
  const cambios = ((data as { cambios?: CambioPrecio[] } | null)?.cambios ?? []).map((c) => ({
    ...c,
    antes: Number(c.antes),
    despues: Number(c.despues),
  }))
  return { cambios }
}
