import { useRef, useState } from 'react'
import type { ErrorFilaImportacion, ResultadoImportacion } from '../../types'
import {
  aFilasDelArchivo,
  importarProductos,
  leerImportacion,
  MAX_FILAS,
  plantillaCSV,
  type LecturaImportacion,
} from '../../lib/importacion'

interface Props {
  // Después de importar de verdad, para refrescar productos/categorías.
  onImportado?: () => void
}

type Paso =
  | { tipo: 'inicial' }
  | { tipo: 'leyendo' }
  | { tipo: 'errores-archivo'; errores: ErrorFilaImportacion[] }
  | { tipo: 'simulando' }
  | { tipo: 'vista-previa'; lectura: LecturaImportacion; resultado: ResultadoImportacion }
  | { tipo: 'importando'; lectura: LecturaImportacion; resultado: ResultadoImportacion }
  | { tipo: 'listo'; resultado: ResultadoImportacion }
  | { tipo: 'fallo'; mensaje: string }

function descargarPlantilla() {
  const blob = new Blob([plantillaCSV()], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'plantilla-productos.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ListaErrores({ errores }: { errores: ErrorFilaImportacion[] }) {
  if (errores.length === 0) return null
  return (
    <ul className="imp-errores" role="alert">
      {errores.map((e, i) => (
        <li key={`${e.fila}-${i}`}>
          <strong>Fila {e.fila}:</strong> {e.mensaje}
        </li>
      ))}
    </ul>
  )
}

function Resumen({ resultado, simulado }: { resultado: ResultadoImportacion; simulado: boolean }) {
  return (
    <div className="imp-resumen">
      <div className="imp-num">
        <strong>{resultado.nuevos}</strong>
        <span>{simulado ? 'nuevos' : 'creados'}</span>
      </div>
      <div className="imp-num">
        <strong>{resultado.actualizados}</strong>
        <span>actualizados</span>
      </div>
      <div className={resultado.errores.length > 0 ? 'imp-num imp-num--error' : 'imp-num'}>
        <strong>{resultado.errores.length}</strong>
        <span>con error</span>
      </div>
    </div>
  )
}

// Ajustes → Importar productos: CSV → vista previa (RPC en modo simulación) →
// importar (todo o nada).
export default function ImportarProductos({ onImportado }: Props) {
  const [paso, setPaso] = useState<Paso>({ tipo: 'inicial' })
  const [archivo, setArchivo] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function reiniciar() {
    setPaso({ tipo: 'inicial' })
    setArchivo(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function alElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setArchivo(file.name)
    setPaso({ tipo: 'leyendo' })
    let texto: string
    try {
      texto = await file.text()
    } catch {
      setPaso({ tipo: 'fallo', mensaje: 'No se pudo leer el archivo.' })
      return
    }
    const lectura = leerImportacion(texto)
    if (lectura.errores.length > 0) {
      setPaso({ tipo: 'errores-archivo', errores: lectura.errores })
      return
    }
    setPaso({ tipo: 'simulando' })
    const r = await importarProductos(lectura.filas, true)
    if (!r.ok) {
      setPaso({ tipo: 'fallo', mensaje: r.mensaje })
      return
    }
    setPaso({ tipo: 'vista-previa', lectura, resultado: aFilasDelArchivo(r.resultado, lectura.lineas) })
  }

  async function importar() {
    if (paso.tipo !== 'vista-previa') return
    const { lectura, resultado } = paso
    setPaso({ tipo: 'importando', lectura, resultado })
    const r = await importarProductos(lectura.filas, false)
    if (!r.ok) {
      setPaso({ tipo: 'fallo', mensaje: r.mensaje })
      return
    }
    const final = aFilasDelArchivo(r.resultado, lectura.lineas)
    if (final.errores.length > 0) {
      // Todo o nada: la base no guardó nada.
      setPaso({ tipo: 'vista-previa', lectura, resultado: final })
      return
    }
    setPaso({ tipo: 'listo', resultado: final })
    onImportado?.()
  }

  const ocupado = paso.tipo === 'leyendo' || paso.tipo === 'simulando' || paso.tipo === 'importando'

  return (
    <>
      <div className="ajustes-subhead">
        <p>
          Cargá o actualizá muchos productos de una vez desde un CSV (Excel → Guardar como CSV). Si el
          SKU ya existe, se actualiza. Máximo {MAX_FILAS} filas por archivo.
        </p>
        <button type="button" className="head-action" onClick={descargarPlantilla}>
          Descargar plantilla
        </button>
      </div>

      <div className="list imp-panel">
        <div className="imp-card">
          <p className="imp-nota">
            Columnas: <code>sku</code>, <code>nombre</code>, <code>descripcion</code>,{' '}
            <code>precio</code>, <code>stock</code>, <code>categoria</code>, <code>imagen_url</code>. La
            categoría va por nombre. <strong>Las fotos se cargan después desde cada producto</strong>{' '}
            (imagen_url es opcional).
          </p>

          <label className={ocupado ? 'imp-file imp-file--off' : 'imp-file'}>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={alElegir}
              disabled={ocupado}
            />
            <span>{archivo ?? 'Elegir archivo .csv'}</span>
          </label>

          {paso.tipo === 'leyendo' && <p className="imp-estado">Leyendo archivo…</p>}
          {paso.tipo === 'simulando' && <p className="imp-estado">Revisando los productos…</p>}

          {paso.tipo === 'errores-archivo' && (
            <>
              <p className="imp-estado imp-estado--error">
                El archivo tiene errores. Corregilos y volvé a subirlo (no se importó nada).
              </p>
              <ListaErrores errores={paso.errores} />
            </>
          )}

          {paso.tipo === 'fallo' && (
            <p className="imp-estado imp-estado--error" role="alert">
              {paso.mensaje}
            </p>
          )}

          {(paso.tipo === 'vista-previa' || paso.tipo === 'importando') && (
            <>
              <p className="imp-estado">
                Vista previa de {paso.lectura.filas.length} productos. Todavía no se guardó nada.
              </p>
              <Resumen resultado={paso.resultado} simulado />
              <ListaErrores errores={paso.resultado.errores} />
              {paso.resultado.errores.length > 0 ? (
                <p className="imp-estado imp-estado--error">
                  Con errores no se importa nada: corregí el archivo y volvé a subirlo.
                </p>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={importar}
                  disabled={paso.tipo === 'importando'}
                >
                  {paso.tipo === 'importando' ? 'Importando…' : 'Importar'}
                </button>
              )}
            </>
          )}

          {paso.tipo === 'listo' && (
            <>
              <p className="imp-estado imp-estado--ok" role="status">
                Listo: se importaron los productos.
              </p>
              <Resumen resultado={paso.resultado} simulado={false} />
            </>
          )}

          {paso.tipo !== 'inicial' && !ocupado && (
            <button type="button" className="btn btn-ghost" onClick={reiniciar}>
              {paso.tipo === 'listo' ? 'Importar otro archivo' : 'Empezar de nuevo'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
