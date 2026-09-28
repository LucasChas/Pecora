// ============================================================================
// Lógica pura de las posiciones de scroll guardadas (ver components/ScrollManager).
// Sin React: arma las claves, lee/escribe el Map en un almacenamiento (en la app,
// sessionStorage) con tope de entradas y decide si corresponde restaurar. El
// almacenamiento llega como función para que acceder a él (que en algunos
// navegadores tira error) quede dentro del try, igual que antes.
// ============================================================================

export const STORAGE_KEY = 'pecora:scroll'
export const MAX_ENTRADAS = 60

// Lo único que se usa del almacenamiento (sessionStorage o uno falso en tests).
export type Almacen = Pick<Storage, 'getItem' | 'setItem'>

// La clave combina la entrada del historial con la ruta: la primera entrada de
// una pestaña siempre tiene key "default", y así una URL distinta abierta en la
// misma pestaña no hereda una posición ajena.
export function claveDe(key: string, pathname: string, search: string): string {
  return `${key}|${pathname}${search}`
}

// Carga en `posiciones` lo guardado en el almacenamiento. Descarta lo que no sea
// un número finito y, si el JSON está roto o el almacenamiento falla, no hace nada.
export function leerPosiciones(obtenerAlmacen: () => Almacen, posiciones: Map<string, number>) {
  try {
    const raw = obtenerAlmacen().getItem(STORAGE_KEY)
    if (!raw) return
    const datos = JSON.parse(raw) as Record<string, unknown>
    for (const [k, v] of Object.entries(datos)) {
      if (typeof v === 'number' && Number.isFinite(v)) posiciones.set(k, v)
    }
  } catch {
    // Sin sessionStorage (modo privado, bloqueado): alcanza con la memoria.
  }
}

// Recorta `posiciones` a MAX_ENTRADAS y lo copia al almacenamiento.
export function escribirPosiciones(obtenerAlmacen: () => Almacen, posiciones: Map<string, number>) {
  // Acota el tamaño: se descartan las entradas más viejas (orden de inserción).
  while (posiciones.size > MAX_ENTRADAS) {
    const primera = posiciones.keys().next().value
    if (primera === undefined) break
    posiciones.delete(primera)
  }
  try {
    obtenerAlmacen().setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(posiciones)))
  } catch {
    // Ignorado: la posición sigue disponible en memoria.
  }
}

export function guardarPosicion(posiciones: Map<string, number>, clave: string, y: number) {
  // delete + set la mueve al final, así el recorte descarta las menos usadas.
  posiciones.delete(clave)
  posiciones.set(clave, y)
}

// En la primera carga del documento solo se restaura si fue una recarga o un
// atrás/adelante del navegador; una URL abierta de cero arranca arriba.
export function cargaInicialRestaurable(
  obtenerNavegacion: () => { type: string } | undefined,
): boolean {
  try {
    const nav = obtenerNavegacion()
    return nav ? nav.type !== 'navigate' : false
  } catch {
    return false
  }
}

// En un atrás/adelante (POP): se restaura si hay una posición guardada y, en la
// carga inicial del documento, solo si esa carga es restaurable (se consulta
// recién ahí, por eso llega como función).
export function debeRestaurar(
  guardada: number | undefined,
  esPrimeraCarga: boolean,
  cargaRestaurable: () => boolean,
): guardada is number {
  if (guardada === undefined) return false
  return !esPrimeraCarga || cargaRestaurable()
}
