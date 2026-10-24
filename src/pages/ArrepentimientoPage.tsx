import { useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import HeaderActions from '../components/account/HeaderActions'
import { waArrepentimientoLink } from '../lib/config'
import { useTitulo } from '../hooks/useTitulo'
import '../styles/catalog.css'
import '../styles/cart.css'

// Botón de arrepentimiento (Res. 424/2020 de la Secretaría de Comercio
// Interior): la clienta pide anular la compra dentro de los 10 días corridos
// desde que recibió el producto. El pedido se manda por WhatsApp con los datos
// para ubicarlo; la dueña responde con la confirmación.
export default function ArrepentimientoPage() {
  useTitulo('Botón de arrepentimiento')
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [pedido, setPedido] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviado, setEnviado] = useState(false)

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim() || !email.trim() || !pedido.replace(/\D/g, '')) {
      setError('Completá tu nombre, tu mail y el número de pedido.')
      return
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Revisá el mail.')
      return
    }
    setError(null)
    window.open(waArrepentimientoLink({ nombre, email, pedido, motivo }), '_blank', 'noopener,noreferrer')
    setEnviado(true)
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

      <main className="legal-page">
        <h1 className="cart-title">Botón de arrepentimiento</h1>

        <div className="legal-card">
          <p>
            Podés arrepentirte de tu compra dentro de los <strong>10 días corridos</strong> desde que recibiste el
            producto, sin dar motivos y sin costo (Ley 24.240, art. 34). El producto tiene que volver sin uso y en
            las mismas condiciones en que lo recibiste.
          </p>

          <form className="checkout-form arrep-form" onSubmit={enviar} noValidate>
            <div className="field">
              <label htmlFor="arrep-nombre">Nombre y apellido</label>
              <input id="arrep-nombre" autoComplete="name" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="arrep-email">Email</label>
              <input id="arrep-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="arrep-pedido">Número de pedido</label>
              <input
                id="arrep-pedido"
                inputMode="numeric"
                placeholder="Ej: 1042"
                value={pedido}
                onChange={(e) => setPedido(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="arrep-motivo">Motivo (opcional)</label>
              <textarea id="arrep-motivo" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-primary">
              Enviar pedido de arrepentimiento
            </button>
            <p className="arrep-nota" role="status">
              {enviado
                ? 'Se abrió WhatsApp con tu pedido. Envialo y te respondemos con la confirmación y cómo devolver el producto.'
                : 'Se abre WhatsApp con los datos cargados. Te respondemos con la confirmación y cómo devolver el producto.'}
            </p>
          </form>

          <p>
            Si preferís, escribinos a <a href="mailto:pecorabril@gmail.com">pecorabril@gmail.com</a> con los mismos
            datos.
          </p>
        </div>

        <Link className="pp-back" to="/ayuda">
          ← Volver a Ayuda
        </Link>
      </main>
    </div>
  )
}
