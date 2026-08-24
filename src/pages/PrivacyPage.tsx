import { Link } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import HeaderActions from '../components/account/HeaderActions'
import '../styles/catalog.css'
import '../styles/cart.css'

export function PrivacyPage() {
  return (
    <div className="catalog-root">
      <header className="cart-header">
        <Logo />
        <HeaderActions />
      </header>
      <Scallop />

      <main className="legal-page">
        <h1 className="cart-title">Política de Privacidad</h1>
        <p className="legal-updated">Última actualización: 24 de agosto de 2026</p>

        <div className="legal-card">
          <p>
            La presente Política de Privacidad describe cómo <strong>Pécora — Accesorios de bebé</strong> (en
            adelante, "Pécora", "nosotros" o "nuestro sitio web", accesible a través de{' '}
            <a href="https://pecora-muestrario.vercel.app/">https://pecora-muestrario.vercel.app/</a>) recopila,
            utiliza, almacena y protege la información proporcionada por los usuarios y clientes al navegar,
            registrarse o realizar pedidos en nuestra plataforma.
          </p>

          <h2>1. Información General</h2>
          <p>
            En Pécora nos comprometemos a garantizar la confidencialidad y seguridad de los datos personales de
            nuestros usuarios. Esta política se aplica a todos los servicios ofrecidos a través de nuestro sitio
            web y los canales de comunicación asociados.
          </p>

          <h2>2. Datos que Recopilamos</h2>
          <p>
            Para permitir la correcta navegación, creación de cuentas y gestión de compras, recopilamos las
            siguientes categorías de datos:
          </p>
          <div className="legal-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th>Datos específicos</th>
                  <th>Propósito</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Identificación</td>
                  <td>Nombre y apellido</td>
                  <td>Identificar al titular de la cuenta o comprador.</td>
                </tr>
                <tr>
                  <td>Contacto</td>
                  <td>Correo electrónico y número de teléfono/WhatsApp</td>
                  <td>Envío de confirmaciones de compra, notificaciones y coordinación de entrega.</td>
                </tr>
                <tr>
                  <td>Logística</td>
                  <td>Dirección de entrega y notas de pedido</td>
                  <td>Coordinación y despacho de los productos adquiridos.</td>
                </tr>
                <tr>
                  <td>Autenticación</td>
                  <td>Credenciales encriptadas de acceso</td>
                  <td>Acceso seguro al panel de usuario y administración.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2>3. Finalidad del Tratamiento de los Datos</h2>
          <p>Los datos personales recabados son utilizados exclusivamente para:</p>
          <ul>
            <li>Procesar y confirmar pedidos realizados en el catálogo.</li>
            <li>Enviar recibos de compra y comprobantes automáticos al correo electrónico del comprador.</li>
            <li>Coordinar el método de pago y entrega a través de canales directos (como WhatsApp o correo electrónico).</li>
            <li>Gestionar la creación y restablecimiento de contraseñas de cuentas registradas.</li>
          </ul>

          <h2>4. Uso de Servicios de Terceros e Integración OAuth</h2>
          <p>Nuestra plataforma utiliza servicios de infraestructura y comunicación provistos por terceros de confianza:</p>
          <ul>
            <li>
              <strong>Google OAuth / Gmail API:</strong> Utilizado de forma interna y automatizada para el despacho
              exclusivo de recibos de compra y notificaciones del sistema desde nuestra casilla oficial
              (<code>pecorabril@gmail.com</code>). No accedemos, leemos ni almacenamos correos personales ajenos a
              las notificaciones generadas por la tienda.
            </li>
            <li><strong>Supabase:</strong> Infraestructura segura para la gestión de bases de datos, autenticación de usuarios y ejecución de funciones de backend.</li>
            <li><strong>Vercel:</strong> Proveedor de alojamiento web y despliegue del frontend.</li>
          </ul>

          <h2>5. Protección y Seguridad de la Información</h2>
          <p>
            Implementamos medidas técnicas y organizativas adecuadas para proteger los datos personales contra
            accesos no autorizados, pérdidas, alteraciones o divulgación indebida. Las contraseñas se almacenan
            mediante algoritmos de cifrado seguro y las conexiones se realizan bajo protocolos HTTPS.
          </p>

          <h2>6. Derechos del Usuario y Contacto</h2>
          <p>
            Los usuarios tienen derecho a solicitar el acceso, rectificación, actualización o eliminación de sus
            datos personales de nuestros registros en cualquier momento. Para ejercer estos derechos o realizar
            cualquier consulta vinculada con esta política, puede comunicarse con nosotros a{' '}
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
