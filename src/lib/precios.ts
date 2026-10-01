import { supabase } from './supabaseClient'

// Ajuste de precios en bloque (RPC ajustar_precios, migración 20261001040000).

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

// Pide la vista previa (simular = true) o aplica el ajuste (false).
export async function ajustarPrecios(
  opciones: OpcionesAjuste,
  simular: boolean,
): Promise<{ cambios: CambioPrecio[] } | { error: string }> {
  const { data, error } = await supabase.rpc('ajustar_precios', {
    p_porcentaje: opciones.porcentaje,
    p_categoria_id: opciones.categoriaId,
    p_redondeo: opciones.redondeo,
    p_simular: simular,
  })
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      return { error: 'Falta aplicar la migración ajustar_precios en Supabase.' }
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
