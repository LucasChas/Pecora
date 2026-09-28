import { useCallback, useEffect, useState } from 'react'
import type { MiembroEquipo } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useDialog } from '../../context/DialogContext'
import { TEXTO_ROL } from '../../lib/roles'
import {
  invitarMiembro,
  listarEquipo,
  puedeRevocar,
  revocarMiembro,
  validarInvitacion,
} from '../../lib/equipo'

type Carga =
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje: string }
  | { estado: 'listo'; miembros: MiembroEquipo[] }

function fechaIngreso(iso: string | null): string {
  if (!iso) return 'Nunca ingresó'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Nunca ingresó'
  return (
    'Último ingreso: ' +
    d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  )
}

// Ajustes → Equipo: quién tiene acceso al panel, invitar empleados y quitarles
// el acceso. Todo pasa por la Edge Function gestionar-equipo.
export default function EquipoAdmin() {
  const { session } = useAuth()
  const { confirmar, avisar } = useDialog()
  const miId = session?.user.id ?? null

  const [carga, setCarga] = useState<Carga>({ estado: 'cargando' })
  const [email, setEmail] = useState('')
  const [nombre, setNombre] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [errorForm, setErrorForm] = useState<string | null>(null)
  const [invitado, setInvitado] = useState<{ email: string; origenLink: string | null } | null>(null)
  const [revocando, setRevocando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCarga({ estado: 'cargando' })
    const r = await listarEquipo()
    setCarga(r.ok ? { estado: 'listo', miembros: r.datos } : { estado: 'error', mensaje: r.mensaje })
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function invitar(e: React.FormEvent) {
    e.preventDefault()
    setInvitado(null)
    const problema = validarInvitacion({ email, nombre })
    if (problema) {
      setErrorForm(problema)
      return
    }
    setErrorForm(null)
    setEnviando(true)
    const r = await invitarMiembro(email, nombre)
    setEnviando(false)
    if (!r.ok) {
      setErrorForm(r.mensaje)
      return
    }
    setInvitado({ email: email.trim(), origenLink: r.datos.origenLink })
    setEmail('')
    setNombre('')
    cargar()
  }

  async function revocar(m: MiembroEquipo) {
    const ok = await confirmar({
      titulo: `¿Quitarle el acceso a ${m.nombre ?? m.email}?`,
      mensaje: 'Ya no va a poder entrar al panel. Sus pedidos y cambios anteriores no se borran.',
      textoOk: 'Quitar acceso',
      peligro: true,
    })
    if (!ok) return
    setRevocando(m.id)
    const r = await revocarMiembro(m.id)
    setRevocando(null)
    if (!r.ok) {
      await avisar({ titulo: 'No se pudo quitar el acceso', mensaje: r.mensaje })
      return
    }
    cargar()
  }

  return (
    <>
      <div className="ajustes-subhead">
        <p>Personas con acceso al panel. Los empleados no ven Ajustes ni Estadísticas.</p>
      </div>

      <div className="list list--ajustes">
        <form className="ajuste-card equipo-invitar" onSubmit={invitar} noValidate>
          <span className="ajuste-titulo">Invitar empleado</span>
          <div className="field">
            <label htmlFor="equipo-email">Email</label>
            <input
              id="equipo-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={enviando}
            />
          </div>
          <div className="field">
            <label htmlFor="equipo-nombre">Nombre</label>
            <input
              id="equipo-nombre"
              type="text"
              autoComplete="off"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              disabled={enviando}
            />
          </div>
          {errorForm && (
            <p className="form-error" role="alert">
              {errorForm}
            </p>
          )}
          {invitado && (
            <p className="equipo-ok" role="status">
              Listo: le mandamos un mail a {invitado.email} para que cree su contraseña.
              {invitado.origenLink && <> El link del mail abre {invitado.origenLink}.</>}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={enviando}>
            {enviando ? 'Invitando…' : 'Invitar'}
          </button>
        </form>

        {carga.estado === 'cargando' ? (
          <div className="empty">Cargando equipo…</div>
        ) : carga.estado === 'error' ? (
          <>
            <div className="empty" role="alert">
              No pudimos cargar el equipo.
              <br />
              {carga.mensaje}
            </div>
            <button className="orders-mas" onClick={cargar}>
              Reintentar
            </button>
          </>
        ) : carga.miembros.length === 0 ? (
          <div className="empty">Todavía no hay nadie más en el equipo.</div>
        ) : (
          carga.miembros.map((m) => (
            <div className="ajuste-card" key={m.id}>
              <div className="ajuste-top">
                <span className="ajuste-titulo">
                  {m.nombre ?? m.email}
                  {m.id === miId && <span className="equipo-yo"> (vos)</span>}
                </span>
                <span className={`equipo-rol equipo-rol--${m.rol}`}>{TEXTO_ROL[m.rol]}</span>
              </div>
              {m.nombre && <p className="ajuste-desc">{m.email}</p>}
              <p className="ajuste-meta">{fechaIngreso(m.ultimo_ingreso)}</p>
              {puedeRevocar(m, miId) && (
                <div className="ajuste-acciones">
                  <button
                    type="button"
                    className="ajuste-btn ajuste-btn--peligro"
                    onClick={() => revocar(m)}
                    disabled={revocando === m.id}
                  >
                    {revocando === m.id ? 'Quitando…' : 'Quitar acceso'}
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </>
  )
}
