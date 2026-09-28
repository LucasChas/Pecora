import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import HeaderActions from '../components/account/HeaderActions'
import { darDeBajaAviso, esTokenValido } from '../lib/avisos'
import '../styles/catalog.css'
import '../styles/cart.css'

type Estado = 'confirmar' | 'enviando' | 'hecho' | 'no_encontrado' | 'error'

// /aviso/baja?token=... — link "No quiero recibir más avisos" del mail de
// reposición. No pide login. Pide un click de confirmación (en vez de dar de
// baja al abrir) para que los antivirus del correo, que abren los links, no
// den de baja a nadie sin querer.
export default function BajaAvisoPage() {
  const [params] = useSearchParams()
  const token = params.get('token')?.trim() ?? ''
  const tokenValido = esTokenValido(token)
  const [estado, setEstado] = useState<Estado>('confirmar')
  const [error, setError] = useState<string | null>(null)

  const onConfirmar = async () => {
    setEstado('enviando')
    setError(null)
    const r = await darDeBajaAviso(token)
    if (!r.ok) {
      setError(r.error)
      setEstado('error')
      return
    }
    setEstado(r.valor ? 'hecho' : 'no_encontrado')
  }

  let contenido: React.ReactNode
  if (!tokenValido || estado === 'no_encontrado') {
    contenido = (
      <p className="aviso-baja-texto">
        Este link no es válido o ya se usó. Si seguís recibiendo avisos que no pediste,
        escribinos y lo resolvemos.
      </p>
    )
  } else if (estado === 'hecho') {
    contenido = (
      <p className="aviso-baja-texto" role="status">
        Listo: no te vamos a mandar más avisos de reposición. Si cambiás de idea, podés volver a
        pedirlos desde cualquier producto sin stock.
      </p>
    )
  } else {
    contenido = (
      <>
        <p className="aviso-baja-texto">
          Vas a dejar de recibir los mails que avisan cuando vuelve a haber stock de un producto.
        </p>
        <button
          type="button"
          className="aviso-btn"
          onClick={onConfirmar}
          disabled={estado === 'enviando'}
          aria-busy={estado === 'enviando'}
        >
          {estado === 'enviando' ? 'Procesando…' : 'Dejar de recibir avisos'}
        </button>
        {error && (
          <p className="aviso-error" role="alert">
            {error}
          </p>
        )}
      </>
    )
  }

  return (
    <div className="catalog-root">
      <header className="cart-header">
        <Link to="/">
          <Logo />
        </Link>
        <HeaderActions />
      </header>
      <Scallop />

      <main className="aviso-baja">
        <h1 className="cart-title">Avisos de reposición</h1>
        <div className="aviso-baja-card">{contenido}</div>
        <Link className="pp-back" to="/">
          ← Volver al muestrario
        </Link>
      </main>
    </div>
  )
}
