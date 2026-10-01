import { supabase } from './supabaseClient'

// ============================================================================
// Direcciones guardadas de la clienta (migración *_favoritos_direcciones):
// se eligen en el checkout y se administran desde Mi cuenta.
// ============================================================================

export const MAX_DIRECCIONES = 10

export interface Direccion {
  id: string
  alias: string
  direccion: string
  localidad: string
  cp: string | null
  provincia: string | null
  principal: boolean
}

export type DatosDireccion = Omit<Direccion, 'id'>

export type Resultado<T = true> = { ok: true; valor: T } | { ok: false; error: string }

const ERROR_GENERICO = 'No pudimos guardar la dirección. Probá de nuevo en un rato.'

export function validarDireccion(d: DatosDireccion): string | null {
  if (!d.alias.trim()) return 'Poné un nombre para reconocerla (ej. Casa).'
  if (d.alias.trim().length > 40) return 'El nombre puede tener hasta 40 letras.'
  if (!d.direccion.trim()) return 'Escribí la calle y el número.'
  if (d.direccion.trim().length > 200) return 'La dirección es demasiado larga.'
  if (!d.localidad.trim()) return 'Escribí la localidad.'
  if (d.localidad.trim().length > 100) return 'La localidad es demasiado larga.'
  if ((d.cp ?? '').trim().length > 20) return 'El código postal es demasiado largo.'
  return null
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** ¿Ya está guardada esta dirección? (misma calle, localidad y CP, sin importar mayúsculas). */
export function yaGuardada(
  lista: readonly Direccion[],
  d: { direccion: string; localidad: string; cp: string | null },
): boolean {
  return lista.some(
    (x) => norm(x.direccion) === norm(d.direccion) && norm(x.localidad) === norm(d.localidad) && norm(x.cp) === norm(d.cp),
  )
}

/** La que el checkout propone primero: la principal o la más nueva. */
export function direccionPorDefecto(lista: readonly Direccion[]): Direccion | null {
  return lista.find((d) => d.principal) ?? lista[0] ?? null
}

/** Nombre automático al guardar desde el checkout ("Casa", después "Dirección 2"...). */
export function aliasSugerido(lista: readonly Direccion[]): string {
  if (lista.length === 0) return 'Casa'
  let n = lista.length + 1
  const usados = new Set(lista.map((d) => norm(d.alias)))
  while (usados.has(norm(`Dirección ${n}`))) n++
  return `Dirección ${n}`
}

function limpiar(d: DatosDireccion): DatosDireccion {
  return {
    alias: d.alias.trim(),
    direccion: d.direccion.trim(),
    localidad: d.localidad.trim(),
    cp: d.cp?.trim() || null,
    provincia: d.provincia?.trim() || null,
    principal: d.principal,
  }
}

/** Las de la cuenta logueada (la principal primero). [] si falla o falta la migración. */
export async function cargarDirecciones(): Promise<Direccion[]> {
  try {
    const { data, error } = await supabase
      .from('direcciones')
      .select('id, alias, direccion, localidad, cp, provincia, principal')
      .order('principal', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) return []
    return (data ?? []) as Direccion[]
  } catch {
    return []
  }
}

export async function guardarDireccion(d: DatosDireccion, id?: string): Promise<Resultado> {
  const v = validarDireccion(d)
  if (v) return { ok: false, error: v }
  const fila = limpiar(d)
  try {
    const { error } = id
      ? await supabase.from('direcciones').update(fila).eq('id', id)
      : await supabase.from('direcciones').insert(fila)
    if (error) return { ok: false, error: error.code === 'P0001' && error.message ? error.message : ERROR_GENERICO }
    return { ok: true, valor: true }
  } catch {
    return { ok: false, error: ERROR_GENERICO }
  }
}

export async function borrarDireccion(id: string): Promise<Resultado> {
  try {
    const { error } = await supabase.from('direcciones').delete().eq('id', id)
    if (error) return { ok: false, error: 'No pudimos borrar la dirección.' }
    return { ok: true, valor: true }
  } catch {
    return { ok: false, error: 'No pudimos borrar la dirección.' }
  }
}
