import AccountButton from './AccountButton'
import CartIcon from '../cart/CartIcon'

// Acciones del header del muestrario: cuenta + carrito.
export default function HeaderActions() {
  return (
    <div className="header-actions">
      <AccountButton />
      <CartIcon />
    </div>
  )
}
