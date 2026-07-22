import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import '../styles/dialog.css'

// Reemplaza los confirm()/alert() del navegador por un diálogo propio, con la
// estética de la marca. La API devuelve una promesa para que el código de las
// pantallas siga leyéndose igual de simple:
//
//   if (!(await confirmar({ titulo: '¿Borrar?' }))) return
//   await avisar({ titulo: 'No se pudo guardar' })

interface OpcionesConfirmar {
  titulo: string
  mensaje?: string
  textoOk?: string
  textoCancelar?: string
  // Acciones destructivas: el botón principal va en rojo.
  peligro?: boolean
}

interface OpcionesAvisar {
  titulo: string
  mensaje?: string
  textoOk?: string
}

interface DialogContextValue {
  confirmar: (opciones: OpcionesConfirmar) => Promise<boolean>
  avisar: (opciones: OpcionesAvisar) => Promise<void>
}

interface DialogoAbierto extends OpcionesConfirmar {
  tipo: 'confirmar' | 'avisar'
}

const DialogContext = createContext<DialogContextValue | null>(null)

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [dialogo, setDialogo] = useState<DialogoAbierto | null>(null)
  // Guardamos el resolve de la promesa hasta que la usuaria decide.
  const resolver = useRef<((valor: boolean) => void) | null>(null)

  const cerrar = useCallback((valor: boolean) => {
    setDialogo(null)
    resolver.current?.(valor)
    resolver.current = null
  }, [])

  const confirmar = useCallback((opciones: OpcionesConfirmar) => {
    setDialogo({ ...opciones, tipo: 'confirmar' })
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const avisar = useCallback((opciones: OpcionesAvisar) => {
    setDialogo({ ...opciones, tipo: 'avisar' })
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    }).then(() => undefined)
  }, [])

  // Escape cancela (en un aviso simplemente lo cierra).
  useEffect(() => {
    if (!dialogo) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [dialogo, cerrar])

  return (
    <DialogContext.Provider value={{ confirmar, avisar }}>
      {children}
      {dialogo && (
        <div className="dlg-overlay" onClick={() => cerrar(false)}>
          <div
            className="dlg-card"
            role="alertdialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="dlg-titulo">{dialogo.titulo}</h2>
            {dialogo.mensaje && <p className="dlg-mensaje">{dialogo.mensaje}</p>}
            <div className="dlg-acciones">
              {dialogo.tipo === 'confirmar' && (
                <button type="button" className="dlg-btn dlg-cancelar" onClick={() => cerrar(false)}>
                  {dialogo.textoCancelar ?? 'Cancelar'}
                </button>
              )}
              <button
                type="button"
                className={dialogo.peligro ? 'dlg-btn dlg-ok peligro' : 'dlg-btn dlg-ok'}
                onClick={() => cerrar(true)}
                autoFocus
              >
                {dialogo.textoOk ?? (dialogo.tipo === 'avisar' ? 'Entendido' : 'Confirmar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  )
}

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog debe usarse dentro de <DialogProvider>')
  return ctx
}
