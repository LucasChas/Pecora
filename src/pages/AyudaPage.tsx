import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import HeaderActions from '../components/account/HeaderActions'
import { waPerfilLink, whatsappVisible } from '../lib/config'
import { useTitulo } from '../hooks/useTitulo'
import '../styles/catalog.css'
import '../styles/cart.css'

// Ayuda: cómo se compra, envíos, pagos, cambios y arrepentimiento. Responde
// en la web lo que antes terminaba siempre en un WhatsApp. Cada sección tiene
// un id para enlazarla desde el footer (/ayuda#envios).
export default function AyudaPage() {
  useTitulo('Ayuda')
  // Los links del footer apuntan a una sección (/ayuda#envios): se baja hasta ahí.
  const { hash } = useLocation()
  useEffect(() => {
    if (!hash) return
    const t = window.setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView(), 50)
    return () => window.clearTimeout(t)
  }, [hash])
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
        <h1 className="cart-title">Ayuda</h1>

        <div className="legal-card">
          <h2 id="comprar">Cómo comprar</h2>
          <ol>
            <li>Elegí los productos y agregalos al carrito.</li>
            <li>En &quot;Finalizar compra&quot; completá tus datos y elegí retiro o envío a domicilio.</li>
            <li>Al confirmar, te llega el comprobante por mail y te escribimos por WhatsApp para coordinar el pago y la entrega.</li>
          </ol>
          <p>Podés comprar con tu cuenta (guarda tus direcciones y te deja usar cupones) o como invitada.</p>

          <h2 id="envios">Envíos y retiro</h2>
          <ul>
            <li>
              <strong>Retiro:</strong> sin costo. Coordinamos el lugar y el horario por WhatsApp.
            </li>
            <li>
              <strong>Envío a domicilio o a sucursal:</strong> el costo se calcula con tu código postal al finalizar
              la compra; si para tu zona no hay tarifa cargada, lo coordinamos por WhatsApp. Cuando sale el pedido te
              pasamos el número de seguimiento.
            </li>
          </ul>

          <h2 id="pagos">Formas de pago</h2>
          <p>
            Por ahora el pago se coordina por WhatsApp al confirmar el pedido: transferencia bancaria o efectivo al
            retirar.
          </p>

          <h2 id="cambios">Cambios y devoluciones</h2>
          <p>
            Si un producto llegó con una falla o necesitás cambiarlo, escribinos por WhatsApp con el número de
            pedido y lo resolvemos.
          </p>

          <h2 id="arrepentimiento">Derecho de arrepentimiento</h2>
          <p>
            Tenés 10 días corridos desde que recibís el producto para arrepentirte de la compra, sin dar motivos
            (Ley 24.240 de Defensa del Consumidor, art. 34). Hacelo desde el{' '}
            <Link to="/arrepentimiento">botón de arrepentimiento</Link>.
          </p>

          <h2 id="contacto">Contacto</h2>
          <p>
            WhatsApp:{' '}
            <a href={waPerfilLink()} target="_blank" rel="noopener noreferrer">
              {whatsappVisible()}
            </a>
            <br />
            Mail: <a href="mailto:pecorabril@gmail.com">pecorabril@gmail.com</a>
          </p>
        </div>

        <Link className="pp-back" to="/">
          ← Volver al muestrario
        </Link>
      </main>
    </div>
  )
}
