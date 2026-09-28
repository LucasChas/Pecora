import { supabase } from './supabaseClient'
import { esFuncionInexistente } from './cupones'
import type { ErrorFilaImportacion, FilaImportacion, ResultadoImportacion } from '../types'

// Carga masiva de productos desde un CSV (Excel "Guardar como CSV").
//
// Todo el parseo es propio (sin dependencias): RFC 4180 con comillas, separador
// "," o ";" detectado solo (Excel en español de Argentina guarda con ";"), BOM
// UTF-8 y números con coma decimal ("1.234,50"). La validación de acá es para
// avisar rápido; la RPC importar_productos vuelve a validar todo en la base.

export const COLUMNAS = [
  'sku',
  'nombre',
  'descripcion',
  'precio',
  'stock',
  'categoria',
  'imagen_url',
] as const

type Columna = (typeof COLUMNAS)[number]

const OBLIGATORIAS: Columna[] = ['sku', 'nombre', 'precio', 'stock', 'categoria']

// Tope de la RPC (todo o nada, en una sola transacción).
export const MAX_FILAS = 500

export type Separador = ',' | ';'

export function quitarBOM(texto: string): string {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto
}

// Mira la primera línea (fuera de comillas) y elige el separador que más aparece.
// Empate o ninguno: coma.
export function detectarSeparador(texto: string): Separador {
  let comas = 0
  let puntoycomas = 0
  let enComillas = false
  for (const c of quitarBOM(texto)) {
    if (c === '"') enComillas = !enComillas
    else if (!enComillas && (c === '\n' || c === '\r')) break
    else if (!enComillas && c === ',') comas++
    else if (!enComillas && c === ';') puntoycomas++
  }
  return puntoycomas > comas ? ';' : ','
}

// Parser RFC 4180: campos entre comillas pueden tener separadores, saltos de
// línea y comillas escapadas (""). Acepta \n, \r\n y \r. Devuelve un registro
// por línea lógica (las líneas vacías vienen como [''], para no correr la
// numeración de filas).
export function parsearCSV(texto: string, separador?: Separador): string[][] {
  const t = quitarBOM(texto)
  const sep = separador ?? detectarSeparador(t)
  const registros: string[][] = []
  let registro: string[] = []
  let campo = ''
  let enComillas = false
  let i = 0

  while (i < t.length) {
    const c = t[i]
    if (enComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"'
          i += 2
          continue
        }
        enComillas = false
      } else {
        campo += c
      }
      i++
      continue
    }
    if (c === '"') {
      enComillas = true
    } else if (c === sep) {
      registro.push(campo)
      campo = ''
    } else if (c === '\n' || c === '\r') {
      registro.push(campo)
      registros.push(registro)
      registro = []
      campo = ''
      if (c === '\r' && t[i + 1] === '\n') i++
    } else {
      campo += c
    }
    i++
  }
  // Último registro (si el archivo no termina en salto de línea).
  if (campo !== '' || registro.length > 0) {
    registro.push(campo)
    registros.push(registro)
  }
  return registros
}

// Número escrito a la argentina o a la inglesa. Devuelve null si no es número.
//   "1.234,50" → 1234.5   "1234,5" → 1234.5   "1,234.50" → 1234.5
//   "1.234" → 1234 (punto de miles)   "12.5" → 12.5   "$ 1.500" → 1500
export function parsearNumero(texto: string): number | null {
  let s = texto.trim().replace(/^\$\s*/, '').replace(/\s/g, '')
  if (s === '') return null
  const negativo = s.startsWith('-')
  if (negativo) s = s.slice(1)
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null

  const ultimaComa = s.lastIndexOf(',')
  const ultimoPunto = s.lastIndexOf('.')
  let normal: string
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    // Los dos: el que va último es el decimal.
    normal =
      ultimaComa > ultimoPunto
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '')
  } else if (ultimaComa >= 0) {
    const partes = s.split(',')
    // Varias comas: separador de miles ("1,234,567"). Una sola: decimal.
    normal = partes.length > 2 ? partes.join('') : s.replace(',', '.')
  } else if (ultimoPunto >= 0) {
    const partes = s.split('.')
    // Varios puntos o un punto seguido de exactamente 3 dígitos: miles.
    normal =
      partes.length > 2 || (partes.length === 2 && partes[1].length === 3 && partes[0] !== '' && partes[0] !== '0')
        ? partes.join('')
        : s
  } else {
    normal = s
  }
  if (!/^\d*\.?\d+$|^\d+\.?$/.test(normal)) return null
  const n = Number(normal)
  if (!Number.isFinite(n)) return null
  return negativo ? -n : n
}

// "Categoría", " SKU ", "imagen url" → nombre de columna canónico.
function normalizarCabecera(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s-]+/g, '_')
}

export interface LecturaImportacion {
  filas: FilaImportacion[]
  // Número de fila del archivo de cada elemento de `filas` (misma posición).
  lineas: number[]
  errores: ErrorFilaImportacion[]
}

function esURL(texto: string): boolean {
  return /^https?:\/\/\S+$/i.test(texto)
}

// Lee el CSV completo y valida cada fila. Las filas con error no van en
// `filas`; si hay algún error no se debería llamar a la RPC (es todo o nada).
export function leerImportacion(texto: string): LecturaImportacion {
  const registros = parsearCSV(texto)
  const errores: ErrorFilaImportacion[] = []
  const filas: FilaImportacion[] = []
  const lineas: number[] = []

  const cabecera = (registros[0] ?? []).map(normalizarCabecera)
  if (cabecera.every((c) => c === '')) {
    return { filas, lineas, errores: [{ fila: 1, mensaje: 'El archivo está vacío.' }] }
  }
  const indice = new Map<string, number>()
  cabecera.forEach((c, i) => {
    if (c && !indice.has(c)) indice.set(c, i)
  })
  const faltan = OBLIGATORIAS.filter((c) => !indice.has(c))
  if (faltan.length > 0) {
    return {
      filas,
      lineas,
      errores: [
        {
          fila: 1,
          mensaje: `Faltan columnas: ${faltan.join(', ')}. Usá la plantilla para ver el formato.`,
        },
      ],
    }
  }

  const valor = (registro: string[], col: Columna) => {
    const i = indice.get(col)
    return i === undefined ? '' : (registro[i] ?? '').trim()
  }

  const skus = new Map<string, number>()
  let conDatos = 0

  registros.slice(1).forEach((registro, i) => {
    const fila = i + 2
    if (registro.every((c) => c.trim() === '')) return
    conDatos++

    const problemas: string[] = []
    const sku = valor(registro, 'sku')
    const nombre = valor(registro, 'nombre')
    const descripcion = valor(registro, 'descripcion')
    const categoria = valor(registro, 'categoria')
    const imagen = valor(registro, 'imagen_url')
    const precioTexto = valor(registro, 'precio')
    const stockTexto = valor(registro, 'stock')

    if (!sku) problemas.push('falta el SKU')
    else {
      const clave = sku.toLowerCase()
      const anterior = skus.get(clave)
      if (anterior !== undefined) problemas.push(`el SKU ${sku} ya está en la fila ${anterior}`)
      else skus.set(clave, fila)
    }
    if (!nombre) problemas.push('falta el nombre')
    if (!categoria) problemas.push('falta la categoría')

    const precio = parsearNumero(precioTexto)
    if (!precioTexto) problemas.push('falta el precio')
    else if (precio === null) problemas.push(`el precio "${precioTexto}" no es un número`)
    else if (precio < 0) problemas.push('el precio no puede ser negativo')

    const stock = parsearNumero(stockTexto)
    if (!stockTexto) problemas.push('falta el stock')
    else if (stock === null || !Number.isInteger(stock)) {
      problemas.push(`el stock "${stockTexto}" tiene que ser un número entero`)
    } else if (stock < 0) problemas.push('el stock no puede ser negativo')

    if (imagen && !esURL(imagen)) problemas.push('imagen_url tiene que empezar con http:// o https://')

    if (problemas.length > 0) {
      const texto = problemas.join('; ')
      errores.push({ fila, mensaje: texto.charAt(0).toUpperCase() + texto.slice(1) + '.' })
      return
    }

    filas.push({
      sku,
      nombre,
      descripcion: descripcion || null,
      precio: Math.round((precio as number) * 100) / 100,
      stock: stock as number,
      categoria,
      imagen_url: imagen || null,
    })
    lineas.push(fila)
  })

  if (conDatos === 0) {
    errores.unshift({ fila: 1, mensaje: 'El archivo no tiene productos (solo el encabezado).' })
  } else if (conDatos > MAX_FILAS) {
    errores.unshift({
      fila: 1,
      mensaje: `El archivo tiene ${conDatos} productos; el máximo por carga es ${MAX_FILAS}. Dividilo en partes.`,
    })
  }

  return { filas, lineas, errores }
}

// Plantilla para descargar. Con ";" y coma decimal, que es lo que abre bien
// Excel en español; el parser igual acepta ",".
export function plantillaCSV(): string {
  const filas = [
    COLUMNAS.join(';'),
    'BODY-001;Body manga larga;Algodón peinado, talle 0 a 3 meses;12.500,00;10;Bodies;',
    'MANTA-002;"Manta ""nube""";;18.900,50;4;Mantas;https://ejemplo.com/manta.jpg',
  ]
  // BOM para que Excel reconozca UTF-8 (tildes y eñes).
  return '﻿' + filas.join('\r\n') + '\r\n'
}

// Normaliza la respuesta jsonb de la RPC (tolera campos faltantes).
export function normalizarResultado(data: unknown): ResultadoImportacion {
  const d = (data ?? {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
  const errores = Array.isArray(d.errores)
    ? d.errores.map((e) => {
        const x = (e ?? {}) as Record<string, unknown>
        return { fila: num(x.fila), mensaje: String(x.mensaje ?? 'Error sin detalle') }
      })
    : []
  return { nuevos: num(d.nuevos), actualizados: num(d.actualizados), errores }
}

// La RPC numera las filas según su posición en p_filas (1 = primera). Las
// pasamos a la fila del archivo para que coincidan con lo que ve la usuaria.
export function aFilasDelArchivo(
  resultado: ResultadoImportacion,
  lineas: number[],
): ResultadoImportacion {
  return {
    ...resultado,
    errores: resultado.errores.map((e) => ({
      ...e,
      fila: lineas[e.fila - 1] ?? e.fila,
    })),
  }
}

export type RespuestaImportacion =
  | { ok: true; resultado: ResultadoImportacion }
  | { ok: false; mensaje: string }

export async function importarProductos(
  filas: FilaImportacion[],
  simular: boolean,
): Promise<RespuestaImportacion> {
  const { data, error } = await supabase.rpc('importar_productos', {
    p_filas: filas,
    p_simular: simular,
  })
  if (error) {
    if (esFuncionInexistente(error, 'importar_productos')) {
      return { ok: false, mensaje: 'Falta aplicar la migración importar_productos en Supabase.' }
    }
    return { ok: false, mensaje: error.message }
  }
  return { ok: true, resultado: normalizarResultado(data) }
}
