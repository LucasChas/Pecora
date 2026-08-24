import { Link } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import HeaderActions from '../components/account/HeaderActions'
import '../styles/catalog.css'
import '../styles/cart.css'

export function TermsPage() {
  return (
    <div className="catalog-root">
      <header className="cart-header">
        <Logo />
        <HeaderActions />
      </header>
      <Scallop />

      <main className="legal-page">
        <h1 className="cart-title">Condiciones del Servicio</h1>
        <p className="legal-updated">Última actualización: 24 de agosto de 2026</p>

        <div className="legal-card">
          <p>
            Bienvenido a <strong>Pécora — Accesorios de bebé</strong>. Al acceder y utilizar nuestro sitio web
            accesible en <a href="https://pecora-muestrario.vercel.app/">https://pecora-muestrario.vercel.app/</a>,
            usted acepta cumplir y estar sujeto a los siguientes términos y condiciones de uso.
          </p>

          <h2>1. Aceptación de los Términos</h2>
          <p>
            El uso de la plataforma, el registro de cuentas o la realización de cualquier pedido constituye la
            aceptación plena y sin reservas de estas Condiciones del Servicio. Si no está de acuerdo con alguno de
            los términos, le solicitamos abstenerse de utilizar el sitio.
          </p>

          <h2>2. Catálogo de Productos y Disponibilidad</h2>
          <p>
            Nos esforzamos por exhibir con la mayor precisión posible los colores, diseños y características de
            nuestros accesorios de bebé. Sin embargo:
          </p>
          <ul>
            <li>Las imágenes son de carácter ilustrativo y pueden presentar leves variaciones según la pantalla o partidas de confección.</li>
            <li>Todos los productos están sujetos a disponibilidad de stock al momento de confirmar el pedido.</li>
            <li>Pécora se reserva el derecho de modificar o discontinuar productos o precios sin previo aviso.</li>
          </ul>

          <h2>3. Proceso de Registro y Cuenta de Usuario</h2>
          <p>
            El usuario es responsable de mantener la confidencialidad de sus datos de acceso (usuario y contraseña)
            y de todas las actividades realizadas desde su cuenta. Pécora no se responsabiliza por pérdidas o
            perjuicios derivados del uso no autorizado de sus credenciales.
          </p>

          <h2>4. Pedidos, Métodos de Pago y Facturación</h2>
          <p>Al realizar una solicitud de compra en el catálogo:</p>
          <ol>
            <li><strong>Generación del pedido:</strong> se creará un comprobante digital enviado automáticamente al correo electrónico registrado.</li>
            <li><strong>Modalidades de pago:</strong> los pagos pueden acordarse mediante transferencia bancaria, efectivo o pasarelas de pago habilitadas (Mercado Pago / pago online) según la opción seleccionada durante el checkout.</li>
            <li><strong>Confirmación final:</strong> la preparación y despacho de los artículos se iniciará una vez acreditado el pago acordado.</li>
          </ol>

          <h2>5. Entregas, Retiros y Logística</h2>
          <p>Los métodos de entrega incluyen retiros en punto acordado o envíos a domicilio:</p>
          <ul>
            <li>Los costos y plazos de envío se coordinan directamente tras la generación del pedido vía WhatsApp o correo electrónico.</li>
            <li>El cliente es responsable de suministrar datos de entrega y de contacto correctos y completos.</li>
          </ul>

          <h2>6. Modificaciones de las Condiciones</h2>
          <p>
            Pécora se reserva el derecho de actualizar o modificar estas Condiciones del Servicio en cualquier
            momento. Los cambios entrarán en vigencia inmediatamente tras su publicación en esta misma página.
          </p>

          <h2>7. Canal de Contacto y Soporte</h2>
          <p>
            Para cualquier consulta sobre pedidos, devoluciones o aclaraciones legales, escribinos a:{' '}
            <a href="mailto:pecorabril@gmail.com">pecorabril@gmail.com</a>.
          </p>
        </div>

        <Link className="pp-back" to="/">
          ← Volver al muestrario
        </Link>
      </main>
    </div>
  )
}
