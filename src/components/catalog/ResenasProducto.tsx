import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import type { MiResena, Resena, ResumenResenas } from '../../types'
import {
  MAX_COMENTARIO,
  borrarResena,
  cargarEstadoPropio,
  cargarResenas,
  estrellasDePromedio,
  formatearFechaResena,
  formatearPromedio,
  guardarResena,
  textoCantidad,
  textoEstrellas,
  validarResena,
} from '../../lib/resenas'
import '../../styles/resenas.css'

// Cuántas reseñas se muestran antes de "Ver todas".
const VISIBLES_INICIALES = 5

type CargaLista =
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje: string }
  | { estado: 'listo'; resumen: ResumenResenas; resenas: Resena[] }
  // Migración sin aplicar: la sección no se muestra.
  | { estado: 'no_disponible' }

type CargaPropia =
  | { estado: 'sin_sesion' }
  | { estado: 'cargando' }
  | { estado: 'listo'; puede: boolean; mia: MiResena | null }

// ---------------------------------------------------------------------------
// Estrellas de solo lectura. `media` agrega media estrella (para promedios).
// ---------------------------------------------------------------------------
function Estrella({ relleno }: { relleno: 'llena' | 'media' | 'vacia' }) {
  // useId() trae ':' y dentro de url(#...) conviene evitarlos.
  const idGradiente = `rs-media-${useId().replace(/:/g, '')}`
  return (
    <svg viewBox="0 0 24 24" className={`rs-estrella rs-estrella--${relleno}`} aria-hidden="true" focusable="false">
      {relleno === 'media' && (
        <defs>
          <linearGradient id={idGradiente}>
            <stop offset="50%" stopColor="currentColor" />
            <stop offset="50%" stopColor="transparent" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"
        fill={relleno === 'llena' ? 'currentColor' : relleno === 'media' ? `url(#${idGradiente})` : 'none'}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Estrellas({
  llenas,
  media = false,
  etiqueta,
}: {
  llenas: number
  media?: boolean
  etiqueta: string
}) {
  return (
    <span className="rs-estrellas" role="img" aria-label={etiqueta}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Estrella key={n} relleno={n <= llenas ? 'llena' : media && n === llenas + 1 ? 'media' : 'vacia'} />
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Selector de estrellas accesible: un grupo de radios nativos (flechas para
// moverse, espacio para elegir), con las estrellas como etiqueta visual.
// ---------------------------------------------------------------------------
function SelectorEstrellas({
  valor,
  onCambiar,
  deshabilitado,
}: {
  valor: number | null
  onCambiar: (n: number) => void
  deshabilitado: boolean
}) {
  const nombre = useId()
  const [resaltadas, setResaltadas] = useState<number | null>(null)
  const pintadas = resaltadas ?? valor ?? 0

  return (
    <fieldset className="rs-selector" disabled={deshabilitado}>
      <legend className="rs-label">Tu calificación</legend>
      <div className="rs-selector-estrellas" onMouseLeave={() => setResaltadas(null)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            className={n <= pintadas ? 'rs-opcion rs-opcion--activa' : 'rs-opcion'}
            onMouseEnter={() => setResaltadas(n)}
          >
            <input
              type="radio"
              className="rs-radio"
              name={nombre}
              value={n}
              checked={valor === n}
              onChange={() => onCambiar(n)}
            />
            <Estrella relleno={n <= pintadas ? 'llena' : 'vacia'} />
            <span className="rs-oculto">{n === 1 ? '1 estrella' : `${n} estrellas`}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// Formulario de alta / edición.
// ---------------------------------------------------------------------------
function FormularioResena({
  productoId,
  inicial,
  onGuardada,
  onCancelar,
}: {
  productoId: string
  inicial: MiResena | null
  onGuardada: () => void
  onCancelar?: () => void
}) {
  const [estrellas, setEstrellas] = useState<number | null>(inicial?.estrellas ?? null)
  const [comentario, setComentario] = useState(inicial?.comentario ?? '')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const idComentario = useId()
  const idContador = useId()

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = validarResena(estrellas, comentario)
    if (!v.ok) {
      setError(v.error)
      return
    }
    setError(null)
    setEnviando(true)
    const r = await guardarResena(productoId, v.estrellas, v.comentario)
    setEnviando(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onGuardada()
  }

  return (
    <form className="rs-form" onSubmit={onSubmit} noValidate>
      <SelectorEstrellas valor={estrellas} onCambiar={setEstrellas} deshabilitado={enviando} />
      <div className="rs-campo">
        <label className="rs-label" htmlFor={idComentario}>
          Comentario <span className="rs-opcional">(opcional)</span>
        </label>
        <textarea
          id={idComentario}
          className="rs-textarea"
          rows={4}
          maxLength={MAX_COMENTARIO}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          disabled={enviando}
          aria-describedby={idContador}
          placeholder="¿Qué te pareció? Talle, calidad, tela…"
        />
        <span className="rs-contador" id={idContador}>
          {comentario.length}/{MAX_COMENTARIO}
        </span>
      </div>
      {error && (
        <p className="rs-error" role="alert">
          {error}
        </p>
      )}
      <div className="rs-form-acciones">
        <button type="submit" className="rs-btn" disabled={enviando}>
          {enviando ? 'Guardando…' : inicial ? 'Guardar cambios' : 'Publicar reseña'}
        </button>
        {onCancelar && (
          <button type="button" className="rs-link" onClick={onCancelar} disabled={enviando}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Sección completa (debajo del detalle del producto).
// ---------------------------------------------------------------------------
export default function ResenasProducto({ productoId }: { productoId: string }) {
  const { session, loading } = useAuth()
  const { pathname, search } = useLocation()
  const userId = session?.user.id ?? null
  const emailCuenta = session?.user.email ?? null

  const [lista, setLista] = useState<CargaLista>({ estado: 'cargando' })
  const [propia, setPropia] = useState<CargaPropia>({ estado: 'sin_sesion' })
  const [editando, setEditando] = useState(false)
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false)
  const [borrando, setBorrando] = useState(false)
  const [errorPropio, setErrorPropio] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [verTodas, setVerTodas] = useState(false)
  const montadoRef = useRef(true)

  useEffect(() => {
    montadoRef.current = true
    return () => {
      montadoRef.current = false
    }
  }, [])

  const cargarLista = useCallback(async () => {
    const r = await cargarResenas(productoId)
    if (!montadoRef.current) return
    if (r.ok) setLista({ estado: 'listo', ...r.valor })
    else if (r.noDisponible) setLista({ estado: 'no_disponible' })
    else setLista({ estado: 'error', mensaje: r.error })
  }, [productoId])

  const cargarPropia = useCallback(async () => {
    if (!userId) {
      setPropia({ estado: 'sin_sesion' })
      return
    }
    setPropia({ estado: 'cargando' })
    const r = await cargarEstadoPropio(productoId)
    if (!montadoRef.current) return
    // Si falla, se comporta como "no puede opinar": la lista igual se ve.
    setPropia(r.ok ? { estado: 'listo', ...r.valor } : { estado: 'listo', puede: false, mia: null })
  }, [productoId, userId])

  // La lista depende también de la cuenta: es_mia sale de quien consulta.
  useEffect(() => {
    setLista({ estado: 'cargando' })
    void cargarLista()
  }, [cargarLista, userId])

  useEffect(() => {
    setEditando(false)
    setConfirmandoBorrado(false)
    void cargarPropia()
  }, [cargarPropia])

  const recargar = () => {
    void cargarLista()
    void cargarPropia()
  }

  const onGuardada = () => {
    setEditando(false)
    setAviso('¡Gracias! Tu reseña quedó guardada.')
    recargar()
  }

  const onBorrar = async () => {
    setBorrando(true)
    setErrorPropio(null)
    const r = await borrarResena(productoId)
    if (!montadoRef.current) return
    setBorrando(false)
    setConfirmandoBorrado(false)
    if (!r.ok) {
      setErrorPropio(r.error)
      return
    }
    setAviso('Borramos tu reseña.')
    recargar()
  }

  if (lista.estado === 'no_disponible') return null

  const resumen = lista.estado === 'listo' ? lista.resumen : null
  const mia = propia.estado === 'listo' ? propia.mia : null
  // La propia se muestra en su bloque, no repetida en la lista.
  const resenas = lista.estado === 'listo' ? lista.resenas.filter((r) => !(mia && r.es_mia)) : []
  const visibles = verTodas ? resenas : resenas.slice(0, VISIBLES_INICIALES)
  const { llenas, media } = estrellasDePromedio(resumen?.promedio)

  // ---- Bloque propio: ingresar / formulario / tu reseña ----
  let bloquePropio: React.ReactNode = null
  if (!loading && !userId) {
    bloquePropio = (
      <p className="rs-nota">
        ¿Compraste este producto?{' '}
        <Link to={`/cuenta?next=${encodeURIComponent(pathname + search)}`}>Ingresá</Link> para dejar tu
        opinión.
      </p>
    )
  } else if (propia.estado === 'listo') {
    if (mia && !editando) {
      bloquePropio = (
        <div className="rs-mia">
          <p className="rs-mia-titulo">Tu reseña</p>
          <Estrellas llenas={mia.estrellas} etiqueta={textoEstrellas(mia.estrellas)} />
          {mia.comentario && <p className="rs-comentario">{mia.comentario}</p>}
          {mia.oculta && (
            <p className="rs-nota">La tienda la ocultó: no se muestra en la página del producto.</p>
          )}
          {confirmandoBorrado ? (
            <div className="rs-form-acciones" role="group" aria-label="Confirmar borrado">
              <span className="rs-confirmar">¿Borrar tu reseña?</span>
              <button type="button" className="rs-btn rs-btn--peligro" onClick={onBorrar} disabled={borrando}>
                {borrando ? 'Borrando…' : 'Sí, borrar'}
              </button>
              <button
                type="button"
                className="rs-link"
                onClick={() => setConfirmandoBorrado(false)}
                disabled={borrando}
              >
                No
              </button>
            </div>
          ) : (
            <div className="rs-form-acciones">
              {propia.puede && (
                <button
                  type="button"
                  className="rs-btn rs-btn--secundario"
                  onClick={() => {
                    setAviso(null)
                    setEditando(true)
                  }}
                >
                  Editar
                </button>
              )}
              <button
                type="button"
                className="rs-link rs-link--peligro"
                onClick={() => {
                  setAviso(null)
                  setConfirmandoBorrado(true)
                }}
              >
                Borrar
              </button>
            </div>
          )}
          {errorPropio && (
            <p className="rs-error" role="alert">
              {errorPropio}
            </p>
          )}
        </div>
      )
    } else if (propia.puede) {
      bloquePropio = (
        <div className="rs-mia">
          <p className="rs-mia-titulo">{mia ? 'Editá tu reseña' : 'Dejá tu reseña'}</p>
          <FormularioResena
            productoId={productoId}
            inicial={mia}
            onGuardada={onGuardada}
            onCancelar={mia ? () => setEditando(false) : undefined}
          />
        </div>
      )
    } else {
      bloquePropio = (
        <p className="rs-nota">
          Pueden opinar quienes compraron este producto. Si lo compraste por WhatsApp, pedinos que
          anotemos {emailCuenta ? <strong>{emailCuenta}</strong> : 'el email de tu cuenta'} en tu
          pedido y vas a poder dejar tu reseña.
        </p>
      )
    }
  }

  return (
    <section className="rs-seccion" aria-labelledby="rs-titulo">
      <div className="rs-cabecera">
        <h2 id="rs-titulo" className="rs-titulo">
          Opiniones
        </h2>
        {resumen && resumen.cantidad > 0 && (
          <div className="rs-resumen">
            <Estrellas
              llenas={llenas}
              media={media}
              etiqueta={`Promedio: ${formatearPromedio(resumen.promedio)} de 5 estrellas`}
            />
            <span className="rs-promedio" aria-hidden="true">
              {formatearPromedio(resumen.promedio)}
            </span>
            <span className="rs-cantidad">({textoCantidad(resumen.cantidad)})</span>
          </div>
        )}
      </div>

      {/* Siempre montado (vacío si no hay aviso) para que se anuncie el cambio. */}
      <p className="rs-ok" role="status" aria-live="polite">
        {aviso ?? ''}
      </p>

      {bloquePropio}

      {lista.estado === 'cargando' && <p className="rs-nota">Cargando opiniones…</p>}
      {lista.estado === 'error' && (
        <p className="rs-error" role="alert">
          No pudimos cargar las opiniones.{' '}
          <button type="button" className="rs-link" onClick={() => void cargarLista()}>
            Reintentar
          </button>
        </p>
      )}
      {lista.estado === 'listo' && resenas.length === 0 && !mia && (
        <p className="rs-nota">Todavía no hay opiniones de este producto.</p>
      )}

      {visibles.length > 0 && (
        <ul className="rs-lista">
          {visibles.map((r) => (
            <li key={r.id} className="rs-item">
              <div className="rs-item-cabecera">
                <Estrellas llenas={r.estrellas} etiqueta={textoEstrellas(r.estrellas)} />
                <span className="rs-autora">{r.nombre_corto}</span>
                <span className="rs-verificada">Compra verificada</span>
              </div>
              {r.comentario && <p className="rs-comentario">{r.comentario}</p>}
              {r.created_at && (
                <time className="rs-fecha" dateTime={r.created_at}>
                  {formatearFechaResena(r.created_at)}
                </time>
              )}
            </li>
          ))}
        </ul>
      )}

      {resenas.length > VISIBLES_INICIALES && (
        <button type="button" className="rs-btn rs-btn--secundario" onClick={() => setVerTodas((v) => !v)}>
          {verTodas ? 'Ver menos' : `Ver todas (${resenas.length})`}
        </button>
      )}
    </section>
  )
}
