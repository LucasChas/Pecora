import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import CatalogPage from './pages/CatalogPage'
import ProductPage from './pages/ProductPage'
import CartPage from './pages/CartPage'
import CheckoutPage from './pages/CheckoutPage'
import AdminPage from './pages/AdminPage'
import CartDrawer from './components/cart/CartDrawer'

// El "modo" define qué expone cada deploy (ver VITE_APP_MODE en .env):
//   - 'admin'   -> deploy privado: SOLO el panel, servido en la raíz "/".
//   - 'catalog' -> deploy público: muestrario + páginas de producto. /admin no existe.
//   - sin definir (desarrollo local) -> todas las rutas.
//
// Con esto podés crear dos proyectos de Vercel desde el MISMO repo, cada uno
// con su dominio y su variable, sin que el admin sea accesible desde la web pública.
const mode = import.meta.env.VITE_APP_MODE

// Layout del catálogo: monta el carrito lateral (drawer) una sola vez, disponible
// en todas las vistas públicas (muestrario, producto, carrito, checkout).
function CatalogLayout() {
  return (
    <>
      <Outlet />
      <CartDrawer />
    </>
  )
}

// Rutas públicas del catálogo (se reusan en modo 'catalog' y en local).
function RutasCatalogo() {
  return (
    <Route element={<CatalogLayout />}>
      <Route path="/" element={<CatalogPage />} />
      <Route path="/producto/:id" element={<ProductPage />} />
      <Route path="/carrito" element={<CartPage />} />
      <Route path="/checkout" element={<CheckoutPage />} />
    </Route>
  )
}

export default function App() {
  if (mode === 'admin') {
    // Deploy privado: el panel vive en la raíz; cualquier otra ruta redirige ahí.
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    )
  }

  if (mode === 'catalog') {
    // Deploy público: muestrario + detalle + carrito/checkout. No se registra /admin.
    return (
      <BrowserRouter>
        <Routes>
          {RutasCatalogo()}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    )
  }

  // Desarrollo local: todas las vistas disponibles.
  return (
    <BrowserRouter>
      <Routes>
        {RutasCatalogo()}
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </BrowserRouter>
  )
}
