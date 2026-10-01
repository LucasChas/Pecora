import { Link } from 'react-router-dom'
import Logo from '../components/Logo'
import Scallop from '../components/Scallop'
import HeaderActions from '../components/account/HeaderActions'
import { useTitulo } from '../hooks/useTitulo'
import '../styles/catalog.css'

// Ruta que no existe (link viejo o mal copiado). Antes redirigía al inicio
// sin decir nada y parecía que el link "no andaba".
export default function NotFoundPage() {
  useTitulo('Página no encontrada')
  return (
    <div className="catalog-root">
      <header className="cart-header">
        <Link to="/">
          <Logo />
        </Link>
        <HeaderActions />
      </header>
      <Scallop />
      <main className="cart-page">
        <h1 className="cart-title">No encontramos esta página</h1>
        <div className="no-results">
          Puede que el link esté incompleto o que el producto ya no esté publicado.
          <br />
          <Link className="pp-back" to="/">
            ← Ir al muestrario
          </Link>
        </div>
      </main>
    </div>
  )
}
